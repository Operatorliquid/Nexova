import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Plus, Package, AlertTriangle, CheckCircle, Clock, Tags, Trash2, MoreVertical, Edit, ReceiptText, RotateCcw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  Badge,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  AnimatedPage,
  AnimatedStagger,
  AnimatedCard,
} from '../../components/ui';
import {
  ProductModal,
  ProductCard,
  StockFilters,
  CategoriesModal,
  DeleteConfirmModal,
  StockReceiptModal,
} from '../../components/stock';
import { useWorkspace } from '../../contexts/AuthContext';
import { useToast } from '../../stores/toast.store';
import { getWorkspaceCommerceCapabilities } from '../../lib/commerce-plan';

const API_URL = import.meta.env.VITE_API_URL || '';
const fetchWithCredentials = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
  ...init,
  credentials: 'include',
});
const VIEW_MODE_STORAGE_KEY = 'stockViewMode';

interface Category {
  id: string;
  name: string;
  color?: string | null;
  productCount?: number;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  price: number;
  stock: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
  images?: string[];
  categories?: Category[];
  unit?: string;
  unitValue?: string;
  secondaryUnit?: string | null;
  secondaryUnitValue?: string | null;
  status?: 'active' | 'archived';
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface StockStats {
  totalProducts: number;
  activeProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
}

interface ProductFormData {
  name: string;
  price: number;
  quantity: number;
  description: string;
  imageUrl: string;
  categoryIds: string[];
  unit: string;
  unitValue: string;
  secondaryUnit: string;
  secondaryUnitValue: string;
}

const UNIT_SHORT_LABELS: Record<string, string> = {
  unit: 'uds',
  kg: 'kg',
  g: 'g',
  l: 'lts',
  ml: 'ml',
  m: 'm',
  cm: 'cm',
};

const SECONDARY_UNIT_LABELS: Record<string, string> = {
  pack: 'Pack',
  box: 'Caja',
  bundle: 'Bulto',
  dozen: 'Docena',
};

export default function StockPage() {
  const workspace = useWorkspace();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenedRef = useRef(false);
  const trashRequestIdRef = useRef(0);

  // Data state
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stats, setStats] = useState<StockStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Filter state
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [stockFilter, setStockFilter] = useState<'all' | 'inStock' | 'lowStock' | 'outOfStock'>('all');

  // Selection state
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    if (typeof window === 'undefined') return 'grid';
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return stored === 'list' ? 'list' : 'grid';
  });

  // Modal state
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showTrashModal, setShowTrashModal] = useState(false);
  const [trashProducts, setTrashProducts] = useState<Product[]>([]);
  const [trashSearchInput, setTrashSearchInput] = useState('');
  const [trashSearch, setTrashSearch] = useState('');
  const [isTrashLoadingInitial, setIsTrashLoadingInitial] = useState(false);
  const [isTrashRefreshing, setIsTrashRefreshing] = useState(false);
  const [hasLoadedTrash, setHasLoadedTrash] = useState(false);
  const [trashActionProductId, setTrashActionProductId] = useState<string | null>(null);

  // API helpers
  const getHeaders = () => ({
    'X-Workspace-Id': workspace?.id || '',
    'Content-Type': 'application/json',
  });

  const readApiError = async (response: Response, fallback: string) => {
    try {
      const body = await response.json();
      if (body?.message && typeof body.message === 'string') return body.message;
      if (body?.error && typeof body.error === 'string') return body.error;
    } catch (_error) {
      // Ignore JSON parse errors and return fallback.
    }
    return fallback;
  };

  // Fetch products
  const fetchProducts = async () => {
    if (!workspace?.id) return;

    try {
      const params = new URLSearchParams({ limit: '100' });
      if (selectedCategory) params.append('categoryId', selectedCategory);

      const response = await fetchWithCredentials(`${API_URL}/api/v1/products?${params}`, {
        headers: getHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        setProducts(data.products || []);
      }
    } catch (error) {
      console.error('Failed to fetch products:', error);
    }
  };

  const fetchTrashProducts = useCallback(async () => {
    if (!workspace?.id) return;

    const requestId = ++trashRequestIdRef.current;
    if (!hasLoadedTrash) {
      setIsTrashLoadingInitial(true);
    } else {
      setIsTrashRefreshing(true);
    }

    try {
      const params = new URLSearchParams({
        limit: '200',
      });

      if (trashSearch.trim()) {
        params.append('search', trashSearch.trim());
      }

      const response = await fetchWithCredentials(`${API_URL}/api/v1/products/trash?${params.toString()}`, {
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, 'No se pudo cargar la papelera'));
      }

      const data = await response.json();
      if (requestId !== trashRequestIdRef.current) return;
      setTrashProducts(data.products || []);
      setHasLoadedTrash(true);
    } catch (error) {
      if (requestId !== trashRequestIdRef.current) return;
      console.error('Failed to fetch trash products:', error);
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la papelera');
    } finally {
      if (requestId !== trashRequestIdRef.current) return;
      setIsTrashLoadingInitial(false);
      setIsTrashRefreshing(false);
    }
  }, [workspace?.id, trashSearch, hasLoadedTrash]);

  // Fetch categories
  const fetchCategories = async () => {
    if (!workspace?.id) return;

    try {
      const response = await fetchWithCredentials(`${API_URL}/api/v1/categories?includeProductCount=true`, {
        headers: getHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories || []);
      }
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  // Fetch stats
  const fetchStats = async () => {
    if (!workspace?.id) return;

    try {
      const response = await fetchWithCredentials(`${API_URL}/api/v1/products/stats`, {
        headers: getHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  // Initial load
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await Promise.all([fetchProducts(), fetchCategories(), fetchStats()]);
      setIsLoading(false);
    };
    loadData();
  }, [workspace?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (!showTrashModal) return;
    const timeoutId = setTimeout(() => {
      setTrashSearch(trashSearchInput.trim());
    }, 280);
    return () => clearTimeout(timeoutId);
  }, [trashSearchInput, showTrashModal]);

  useEffect(() => {
    if (!showTrashModal || !workspace?.id) return;
    fetchTrashProducts();
  }, [showTrashModal, workspace?.id, trashSearch, fetchTrashProducts]);

  useEffect(() => {
    const productId = searchParams.get('productId');
    if (!productId || autoOpenedRef.current || products.length === 0) return;

    const match = products.find((product) => product.id === productId);
    if (match) {
      setEditingProduct(match);
      setShowProductModal(true);
      autoOpenedRef.current = true;

      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('productId');
      setSearchParams(nextParams, { replace: true });
    }
  }, [products, searchParams, setSearchParams]);

  // Refetch when category filter changes
  useEffect(() => {
    fetchProducts();
  }, [selectedCategory]);

  // Create product
  const handleCreateProduct = async (data: ProductFormData) => {
    const response = await fetchWithCredentials(`${API_URL}/api/v1/products`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        sku: `SKU-${Date.now().toString(36).toUpperCase()}`,
        name: data.name,
        description: data.description || undefined,
        price: Math.round(data.price * 100),
        initialStock: data.quantity,
        images: data.imageUrl ? [data.imageUrl] : [],
        categoryIds: data.categoryIds,
        unit: data.unit,
        unitValue: data.unit !== 'unit' ? data.unitValue : '',
        secondaryUnit: data.secondaryUnit || null,
        secondaryUnitValue: data.secondaryUnit ? data.secondaryUnitValue : null,
        status: 'active',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al crear producto');
    }

    toast.success('Producto creado exitosamente');
    await Promise.all([fetchProducts(), fetchStats(), fetchCategories()]);
  };

  // Update product
  const handleUpdateProduct = async (data: ProductFormData) => {
    if (!editingProduct) return;

    const response = await fetchWithCredentials(`${API_URL}/api/v1/products/${editingProduct.id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({
        name: data.name,
        description: data.description || null,
        price: Math.round(data.price * 100),
        images: data.imageUrl ? [data.imageUrl] : [],
        categoryIds: data.categoryIds,
        unit: data.unit,
        unitValue: data.unit !== 'unit' ? data.unitValue : null,
        secondaryUnit: data.secondaryUnit || null,
        secondaryUnitValue: data.secondaryUnit ? data.secondaryUnitValue : null,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al actualizar producto');
    }

    // Update stock if changed
    if (data.quantity !== editingProduct.stock) {
      const stockDiff = data.quantity - editingProduct.stock;
      await fetchWithCredentials(`${API_URL}/api/v1/products/${editingProduct.id}/stock`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({
          quantity: stockDiff,
          reason: 'Ajuste desde edicion de producto',
        }),
      });
    }

    toast.success('Producto actualizado');
    await Promise.all([fetchProducts(), fetchStats(), fetchCategories()]);
  };

  // Delete product
  const handleDeleteProduct = async () => {
    setIsDeleting(true);
    try {
      if (productToDelete) {
        // Single delete
        const response = await fetchWithCredentials(`${API_URL}/api/v1/products/${productToDelete.id}`, {
          method: 'DELETE',
          headers: getHeaders(),
        });

        if (!response.ok) throw new Error(await readApiError(response, 'Error al eliminar producto'));
        toast.success(`"${productToDelete.name}" eliminado`);
      } else if (selectedProductIds.size > 0) {
        // Bulk delete
        const response = await fetchWithCredentials(`${API_URL}/api/v1/products/bulk`, {
          method: 'DELETE',
          headers: getHeaders(),
          body: JSON.stringify({ productIds: Array.from(selectedProductIds) }),
        });

        if (!response.ok) throw new Error(await readApiError(response, 'Error al eliminar productos'));
        toast.success(`${selectedProductIds.size} productos eliminados`);
        setSelectedProductIds(new Set());
        setIsSelectMode(false);
      }

      await Promise.all([fetchProducts(), fetchStats(), fetchCategories()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setProductToDelete(null);
    }
  };

  const handleRestoreProduct = async (product: Product) => {
    if (!workspace?.id) return;
    setTrashActionProductId(product.id);
    try {
      const response = await fetchWithCredentials(`${API_URL}/api/v1/products/${product.id}/restore`, {
        method: 'POST',
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, 'No se pudo restaurar el producto'));
      }

      toast.success(`"${product.name}" restaurado`);
      await Promise.all([fetchTrashProducts(), fetchProducts(), fetchStats(), fetchCategories()]);
    } catch (error) {
      console.error('Failed to restore product:', error);
      toast.error(error instanceof Error ? error.message : 'No se pudo restaurar el producto');
    } finally {
      setTrashActionProductId(null);
    }
  };

  const handlePermanentDeleteProduct = async (product: Product) => {
    if (!workspace?.id) return;

    const confirmed = window.confirm(
      `Eliminar permanentemente "${product.name}"?\nEsta acción no se puede deshacer.`
    );
    if (!confirmed) return;

    setTrashActionProductId(product.id);
    try {
      const response = await fetchWithCredentials(`${API_URL}/api/v1/products/${product.id}/permanent`, {
        method: 'DELETE',
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, 'No se pudo eliminar permanentemente el producto'));
      }

      toast.success(`"${product.name}" eliminado permanentemente`);
      await Promise.all([fetchTrashProducts(), fetchProducts(), fetchStats(), fetchCategories()]);
    } catch (error) {
      console.error('Failed to permanently delete product:', error);
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar permanentemente el producto');
    } finally {
      setTrashActionProductId(null);
    }
  };

  // Create category
  const handleCreateCategory = async (name: string, color?: string): Promise<Category | null> => {
    const response = await fetchWithCredentials(`${API_URL}/api/v1/categories`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, color }),
    });

    if (!response.ok) {
      const error = await response.json();
      toast.error(error.message || 'Error al crear categoria');
      return null;
    }

    const data = await response.json();
    toast.success(`Categoria "${name}" creada`);
    await fetchCategories();
    return data.category;
  };

  // Delete category
  const handleDeleteCategory = async (categoryId: string) => {
    const response = await fetchWithCredentials(`${API_URL}/api/v1/categories/${categoryId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });

    if (!response.ok) {
      toast.error('Error al eliminar categoria');
      return;
    }

    toast.success('Categoria eliminada');
    await fetchCategories();
    if (selectedCategory === categoryId) {
      setSelectedCategory(null);
    }
  };

  const handleUpdateCategory = async (categoryId: string, color: string) => {
    const response = await fetchWithCredentials(`${API_URL}/api/v1/categories/${categoryId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ color }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      toast.error(error.message || 'Error al actualizar la categoría');
      return;
    }

    await fetchCategories();
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(price / 100);
  };

  const getStockVariant = (product: Product) => {
    if (product.isOutOfStock) return 'destructive';
    if (product.isLowStock) return 'warning';
    return 'success';
  };

  // Filter products locally
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        if (
          !p.name.toLowerCase().includes(searchLower) &&
          !p.sku.toLowerCase().includes(searchLower)
        ) {
          return false;
        }
      }

      // Stock filter
      if (stockFilter === 'inStock' && (p.isOutOfStock || p.isLowStock)) return false;
      if (stockFilter === 'lowStock' && !p.isLowStock) return false;
      if (stockFilter === 'outOfStock' && !p.isOutOfStock) return false;

      return true;
    });
  }, [products, search, stockFilter]);

  // Stats display
  const statsData = [
    {
      icon: Package,
      value: stats?.totalProducts || 0,
      label: 'Total productos',
      iconBg: 'bg-primary/10',
      iconColor: 'text-primary',
    },
    {
      icon: CheckCircle,
      value: stats?.activeProducts || 0,
      label: 'Activos',
      iconBg: 'bg-emerald-500/10',
      iconColor: 'text-emerald-400',
    },
    {
      icon: Clock,
      value: stats?.lowStockCount || 0,
      label: 'Stock bajo',
      iconBg: 'bg-amber-500/10',
      iconColor: 'text-amber-400',
      highlight: (v: number) => v > 0 ? 'text-foreground' : undefined,
    },
    {
      icon: AlertTriangle,
      value: stats?.outOfStockCount || 0,
      label: 'Sin stock',
      iconBg: 'bg-red-500/10',
      iconColor: 'text-red-400',
      highlight: (v: number) => v > 0 ? 'text-red-400' : undefined,
    },
  ];

  return (
    <div className="h-full overflow-y-auto scrollbar-hide p-6">
      <AnimatedPage className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Inventario</h1>
            <p className="text-sm text-muted-foreground">
              Gestiona tus productos y stock
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setShowTrashModal(true);
                setTrashSearchInput('');
                setTrashSearch('');
                setHasLoadedTrash(false);
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Papelera
            </Button>
            {capabilities.showStockReceiptImport && (
              <Button
                variant="secondary"
                onClick={() => setShowReceiptModal(true)}
              >
                <ReceiptText className="w-4 h-4 mr-2" />
                Cargar boleta
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => setShowCategoriesModal(true)}
            >
              <Tags className="w-4 h-4 mr-2" />
              Categorías
            </Button>
            <Button
              onClick={() => {
                setEditingProduct(null);
                setShowProductModal(true);
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Agregar producto
            </Button>
          </div>
        </div>

        {/* Stats */}
        <AnimatedStagger className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {statsData.map((stat, i) => (
            <AnimatedCard key={i}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  {isLoading ? (
                    <div className="animate-pulse rounded-lg bg-secondary h-7 w-16 mt-1" />
                  ) : (
                    <p className={`text-2xl font-semibold mt-1 ${stat.highlight?.(stat.value) || 'text-foreground'}`}>
                      {stat.value}
                    </p>
                  )}
                </div>
                <div className={`w-10 h-10 rounded-xl ${stat.iconBg} flex items-center justify-center`}>
                  <stat.icon className={`w-5 h-5 ${stat.iconColor}`} />
                </div>
              </div>
            </AnimatedCard>
          ))}
        </AnimatedStagger>

        {/* Filters */}
        <StockFilters
          search={search}
          onSearchChange={setSearch}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          categories={categories}
          stockFilter={stockFilter}
          onStockFilterChange={setStockFilter}
          isSelectMode={isSelectMode}
          onSelectModeToggle={() => {
            setIsSelectMode(!isSelectMode);
            setSelectedProductIds(new Set());
          }}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />

        {/* Selection actions bar */}
        {selectedProductIds.size > 0 && (
          <div className="flex items-center justify-between p-4 rounded-xl bg-primary/10 border border-primary/20">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/20">
                <span className="text-sm font-bold text-primary">{selectedProductIds.size}</span>
              </div>
              <span className="text-foreground font-medium">
                productos seleccionados
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Eliminar seleccionados
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSelectedProductIds(new Set());
                  setIsSelectMode(false);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Products */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="glass-card rounded-2xl p-12 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-secondary flex items-center justify-center">
              <Package className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <p className="text-muted-foreground">No hay productos</p>
            <p className="text-sm text-muted-foreground/50 mt-1">
              {search || selectedCategory || stockFilter !== 'all'
                ? 'Prueba ajustando los filtros'
                : 'Agrega productos para empezar a gestionar tu inventario'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                isSelected={selectedProductIds.has(product.id)}
                isSelectMode={isSelectMode}
                onSelect={(selected) => {
                  const newSet = new Set(selectedProductIds);
                  if (selected) {
                    newSet.add(product.id);
                  } else {
                    newSet.delete(product.id);
                  }
                  setSelectedProductIds(newSet);
                }}
                onEdit={() => {
                  setEditingProduct(product);
                  setShowProductModal(true);
                }}
                onDelete={() => {
                  setProductToDelete(product);
                  setShowDeleteConfirm(true);
                }}
                onAddCategory={() => {
                  setEditingProduct(product);
                  setShowProductModal(true);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="hidden md:flex items-center gap-4 px-4 py-3 text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
              <div className="flex-1">Producto</div>
              <div className="w-28 text-right">Precio</div>
              <div className="w-28 text-right">Stock</div>
              <div className="w-52">Categorías</div>
              <div className="w-10" />
            </div>
            <div className="divide-y divide-border">
              {filteredProducts.map((product) => {
                const isSelected = selectedProductIds.has(product.id);
                const rawImageUrl = product.images?.[0];
                const imageUrl = rawImageUrl?.startsWith('/') ? `${API_URL}${rawImageUrl}` : rawImageUrl;
                const primaryValue = product.unitValue?.toString();
                const secondaryValue = product.secondaryUnitValue?.toString();
                const primaryBadge = product.unit && product.unit !== 'unit' && primaryValue
                  ? `${primaryValue} ${UNIT_SHORT_LABELS[product.unit] || product.unit}`
                  : null;
                const secondaryLabel = product.secondaryUnit
                  ? (SECONDARY_UNIT_LABELS[product.secondaryUnit] || product.secondaryUnit)
                  : '';
                const secondaryBadge = product.secondaryUnit
                  ? secondaryValue
                    ? `${secondaryLabel} ${secondaryValue}`.trim()
                    : secondaryLabel
                  : null;
                const handleSelectToggle = (selected: boolean) => {
                  const newSet = new Set(selectedProductIds);
                  if (selected) {
                    newSet.add(product.id);
                  } else {
                    newSet.delete(product.id);
                  }
                  setSelectedProductIds(newSet);
                };

                return (
                  <div
                    key={product.id}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (
                        target.closest('button') ||
                        target.closest('input') ||
                        target.closest('label') ||
                        target.closest('[role="menu"]')
                      ) {
                        return;
                      }
                      if (isSelectMode) {
                        handleSelectToggle(!isSelected);
                        return;
                      }
                      setEditingProduct(product);
                      setShowProductModal(true);
                    }}
                    className={`group px-4 py-3 transition-colors ${
                      isSelected ? 'bg-primary/10' : 'hover:bg-secondary/50'
                    }`}
                  >
                    <div className="flex flex-col md:flex-row md:items-center md:gap-4">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {isSelectMode && (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => handleSelectToggle(Boolean(checked))}
                            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                          />
                        )}
                        <div className="w-12 h-12 rounded-xl bg-muted/30 flex items-center justify-center overflow-hidden">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={product.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <Package className="w-6 h-6 text-muted-foreground/40" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-foreground truncate">{product.name}</p>
                            {(primaryBadge || secondaryBadge) && (
                              <span className="inline-flex items-center gap-1">
                                {primaryBadge && (
                                  <Badge
                                    variant="secondary"
                                    className="px-2 py-0.5 text-[10px] font-medium text-foreground bg-secondary border-border"
                                  >
                                    {primaryBadge}
                                  </Badge>
                                )}
                                {secondaryBadge && (
                                  <Badge
                                    variant="secondary"
                                    className="px-2 py-0.5 text-[10px] font-medium text-foreground bg-secondary border-border"
                                  >
                                    {secondaryBadge}
                                  </Badge>
                                )}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono truncate">{product.sku}</p>
                        </div>
                      </div>

                      <div className="mt-2 md:mt-0 md:w-28 md:text-right">
                        <span className="font-semibold text-foreground">{formatPrice(product.price)}</span>
                      </div>

                      <div className="mt-2 md:mt-0 md:w-28 md:flex md:justify-end">
                        <Badge variant={getStockVariant(product)}>
                          {product.isOutOfStock ? 'Sin stock' : `${product.stock} uds`}
                        </Badge>
                      </div>

                      <div className="mt-2 md:mt-0 md:w-52">
                        {product.categories && product.categories.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {product.categories.slice(0, 3).map((cat) => (
                              <Badge
                                key={cat.id}
                                variant="secondary"
                                className="text-xs"
                                style={cat.color ? { borderColor: `${cat.color}40`, color: cat.color, backgroundColor: `${cat.color}15` } : undefined}
                              >
                                {cat.name}
                              </Badge>
                            ))}
                            {product.categories.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{product.categories.length - 3}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin categorías</span>
                        )}
                      </div>

                      <div className="mt-3 md:mt-0 md:w-10 md:flex md:justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-2 rounded-lg bg-secondary/60 hover:bg-secondary transition-colors">
                              <MoreVertical className="w-4 h-4 text-muted-foreground" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingProduct(product);
                                setShowProductModal(true);
                              }}
                            >
                              <Tags className="w-4 h-4" />
                              Agregar categoría
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingProduct(product);
                                setShowProductModal(true);
                              }}
                            >
                              <Edit className="w-4 h-4" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              destructive
                              onClick={() => {
                                setProductToDelete(product);
                                setShowDeleteConfirm(true);
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                              Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </AnimatedPage>

      {/* Modals - Outside max-w-7xl container for proper full-screen overlay */}
      <ProductModal
        isOpen={showProductModal}
        onClose={() => {
          setShowProductModal(false);
          setEditingProduct(null);
        }}
        onSave={editingProduct ? handleUpdateProduct : handleCreateProduct}
        product={editingProduct}
        categories={categories}
        onCreateCategory={handleCreateCategory}
        workspaceId={workspace?.id || ''}
      />

      <CategoriesModal
        isOpen={showCategoriesModal}
        onClose={() => setShowCategoriesModal(false)}
        categories={categories}
        onCreateCategory={handleCreateCategory}
        onUpdateCategory={handleUpdateCategory}
        onDeleteCategory={handleDeleteCategory}
      />

      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setProductToDelete(null);
        }}
        onConfirm={handleDeleteProduct}
        title={productToDelete ? 'Eliminar producto' : 'Eliminar productos'}
        message={
          productToDelete
            ? `¿Eliminar "${productToDelete.name}"?`
            : `¿Eliminar ${selectedProductIds.size} productos?`
        }
        itemCount={productToDelete ? 1 : selectedProductIds.size}
        isLoading={isDeleting}
      />

      <Dialog
        open={showTrashModal}
        onOpenChange={(open) => {
          setShowTrashModal(open);
          if (!open) {
            trashRequestIdRef.current += 1;
            setHasLoadedTrash(false);
            setIsTrashLoadingInitial(false);
            setIsTrashRefreshing(false);
            setTrashProducts([]);
            setTrashSearchInput('');
            setTrashSearch('');
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div className="flex-1">
                <DialogTitle>Papelera</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {trashProducts.length} producto{trashProducts.length !== 1 ? 's' : ''} en papelera
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="py-4 border-b border-border">
            <Input
              value={trashSearchInput}
              onChange={(e) => setTrashSearchInput(e.target.value)}
              placeholder="Buscar por nombre o SKU"
            />
          </div>

          <div className="flex-1 overflow-y-auto py-4 min-h-[360px] relative">
            {isTrashRefreshing && hasLoadedTrash && (
              <div className="absolute top-2 right-2 z-10 inline-flex items-center gap-2 rounded-full bg-secondary/90 border border-border px-3 py-1 text-xs text-muted-foreground">
                <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Actualizando
              </div>
            )}

            {isTrashLoadingInitial && !hasLoadedTrash ? (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
                <p className="text-muted-foreground">Cargando papelera...</p>
              </div>
            ) : trashProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                  <Trash2 className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-muted-foreground">Papelera vacía</p>
                <p className="text-sm text-muted-foreground/50 mt-1">
                  Los productos eliminados aparecerán aquí y podrás restaurarlos
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {trashProducts.map((product) => {
                  const isBusy = trashActionProductId === product.id;
                  const statusLabel = product.deletedAt || product.status === 'archived'
                    ? 'Archivado'
                    : 'Inactivo';

                  return (
                    <div
                      key={product.id}
                      className="flex items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
                    >
                      <div className="w-12 h-12 rounded-xl bg-background/50 flex items-center justify-center flex-shrink-0">
                        <Package className="w-5 h-5 text-muted-foreground/70" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-foreground truncate">{product.name}</p>
                          <Badge variant="secondary">{statusLabel}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          SKU: {product.sku}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRestoreProduct(product)}
                        disabled={isBusy}
                        className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                      >
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Restaurar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePermanentDeleteProduct(product)}
                        disabled={isBusy}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Borrar permanente
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="pt-3 border-t border-border">
            <Button variant="secondary" onClick={() => setShowTrashModal(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {workspace?.id && capabilities.showStockReceiptImport && (
        <StockReceiptModal
          open={showReceiptModal}
          onOpenChange={setShowReceiptModal}
          workspaceId={workspace.id}
          onApplied={async () => {
            await Promise.all([fetchProducts(), fetchStats()]);
          }}
        />
      )}
    </div>
  );
}
