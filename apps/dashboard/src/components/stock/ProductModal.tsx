import { useState, useEffect, useRef } from 'react';
import { Plus, ImagePlus, Package, AlertTriangle } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui';
import { cn } from '../../lib/utils';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Category {
  id: string;
  name: string;
  color?: string | null;
}

const UNIT_OPTIONS = [
  { value: 'unit', label: 'Sin unidad', short: 'uds' },
  { value: 'kg', label: 'Kilogramo', short: 'kg' },
  { value: 'g', label: 'Gramo', short: 'g' },
  { value: 'l', label: 'Litro', short: 'lts' },
  { value: 'ml', label: 'Mililitro', short: 'ml' },
  { value: 'm', label: 'Metro', short: 'm' },
  { value: 'cm', label: 'Centímetro', short: 'cm' },
];

const SECONDARY_UNIT_OPTIONS = [
  { value: 'none', label: 'Sin segunda unidad' },
  { value: 'pack', label: 'Pack' },
  { value: 'box', label: 'Caja' },
  { value: 'bundle', label: 'Bulto' },
  { value: 'dozen', label: 'Docena' },
];

const SECONDARY_UNIT_LABELS: Record<string, string> = {
  pack: 'Pack',
  box: 'Caja',
  bundle: 'Bulto',
  dozen: 'Docena',
};

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

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  description?: string | null;
  images?: string[];
  categories?: Category[];
  unit?: string;
  unitValue?: string;
  secondaryUnit?: string | null;
  secondaryUnitValue?: string | null;
}

interface ProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ProductFormData) => Promise<void>;
  product?: Product | null;
  categories: Category[];
  onCreateCategory: (name: string, color?: string) => Promise<Category | null>;
  workspaceId: string;
}

export function ProductModal({
  isOpen,
  onClose,
  onSave,
  product,
  categories,
  onCreateCategory,
  workspaceId,
}: ProductModalProps) {
  const [formData, setFormData] = useState<ProductFormData>({
    name: '',
    price: 0,
    quantity: 0,
    description: '',
    imageUrl: '',
    categoryIds: [],
    unit: 'unit',
    unitValue: '',
    secondaryUnit: '',
    secondaryUnitValue: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#6366f1');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const handleImageUpload = async (file: File) => {
    setIsUploading(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev) => ({ ...prev, imageUrl: reader.result as string }));
        setIsUploading(false);
      };
      reader.onerror = () => {
        setError('Error al cargar la imagen');
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
      setPendingFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir imagen');
      setIsUploading(false);
    }
  };

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name,
        price: product.price / 100,
        quantity: product.stock,
        description: product.description || '',
        imageUrl: product.images?.[0] || '',
        categoryIds: product.categories?.map((c) => c.id) || [],
        unit: product.unit || 'unit',
        unitValue: product.unitValue?.toString() || '',
        secondaryUnit: product.secondaryUnit || '',
        secondaryUnitValue:
          product.secondaryUnitValue?.toString() ||
          (product.secondaryUnit === 'dozen' ? '12' : ''),
      });
    } else {
      setFormData({
        name: '',
        price: 0,
        quantity: 0,
        description: '',
        imageUrl: '',
        categoryIds: [],
        unit: 'unit',
        unitValue: '',
        secondaryUnit: '',
        secondaryUnitValue: '',
      });
    }
    setError(null);
    setPendingFile(null);
  }, [product, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('El nombre es requerido');
      return;
    }
    if (formData.price < 0) {
      setError('El precio debe ser mayor o igual a 0');
      return;
    }
    if (formData.secondaryUnit && formData.secondaryUnit !== 'dozen' && !formData.secondaryUnitValue) {
      setError('El valor de la segunda unidad es requerido');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      let finalImageUrl = formData.imageUrl;

      if (pendingFile) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', pendingFile);

        const response = await fetch(`${API_URL}/api/v1/uploads/product-image`, {
          method: 'POST',
          headers: {
            'X-Workspace-Id': workspaceId,
          },
          body: uploadFormData,
          credentials: 'include',
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Error al subir imagen');
        }

        const data = await response.json();
        finalImageUrl = data.url;
      }

      await onSave({ ...formData, imageUrl: finalImageUrl });
      setPendingFile(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;

    setIsLoading(true);
    try {
      const category = await onCreateCategory(newCategoryName.trim(), newCategoryColor);
      if (category) {
        setFormData((prev) => ({
          ...prev,
          categoryIds: [...prev.categoryIds, category.id],
        }));
      }
      setNewCategoryName('');
      setIsCreatingCategory(false);
    } catch {
      setError('Error al crear categoría');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCategory = (categoryId: string) => {
    setFormData((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(categoryId)
        ? prev.categoryIds.filter((id) => id !== categoryId)
        : [...prev.categoryIds, categoryId],
    }));
  };

  // Get display image URL (handle relative paths)
  const displayImageUrl = formData.imageUrl?.startsWith('/')
    ? `${API_URL}${formData.imageUrl}`
    : formData.imageUrl;

  const primarySuffix =
    formData.unit !== 'unit' && formData.unitValue
      ? `${formData.unitValue} ${UNIT_OPTIONS.find((u) => u.value === formData.unit)?.short || formData.unit}`
      : '';
  const secondaryLabel = formData.secondaryUnit ? (SECONDARY_UNIT_LABELS[formData.secondaryUnit] || formData.secondaryUnit) : '';
  const secondarySuffix = formData.secondaryUnit
    ? formData.secondaryUnitValue
      ? `${secondaryLabel} ${formData.secondaryUnitValue}`.trim()
      : secondaryLabel
    : '';
  const previewName = [formData.name, primarySuffix, secondarySuffix].filter(Boolean).join(' ').trim();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader className="pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle>
                {product ? 'Editar producto' : 'Nuevo producto'}
              </DialogTitle>
              <DialogDescription>
                {product ? 'Modificá los datos del producto' : 'Completá los datos del nuevo producto'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-5 py-4 px-1 -mx-1">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Image Upload */}
          <div className="flex items-start gap-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'relative w-24 h-24 rounded-2xl flex items-center justify-center cursor-pointer transition-all overflow-hidden group',
                'border-2 border-dashed border-border hover:border-primary/50',
                !displayImageUrl && 'bg-secondary'
              )}
            >
              {displayImageUrl ? (
                <>
                  <img
                    src={displayImageUrl}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <ImagePlus className="w-6 h-6 text-white" />
                  </div>
                </>
              ) : isUploading ? (
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
              ) : (
                <Package className="w-8 h-8 text-muted-foreground/50" />
              )}
            </div>
            <div className="flex-1 pt-1">
              <Label className="text-foreground mb-2 block">Imagen del producto</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  isLoading={isUploading}
                >
                  <ImagePlus className="w-4 h-4 mr-1.5" />
                  {displayImageUrl ? 'Cambiar' : 'Subir imagen'}
                </Button>
                {displayImageUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFormData((prev) => ({ ...prev, imageUrl: '' }));
                      setPendingFile(null);
                    }}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    Eliminar
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">JPG, PNG, WebP. Máximo 5MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(file);
              }}
            />
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Nombre *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Nombre del producto"
              required
            />
          </div>

          {/* Unit of measure & Content */}
          <div className={cn('grid gap-3', formData.unit !== 'unit' ? 'grid-cols-2' : 'grid-cols-1')}>
            <div className="space-y-2">
              <Label>Unidad de medida</Label>
              <Select
                value={formData.unit}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, unit: value, unitValue: value === 'unit' ? '' : prev.unitValue }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin unidad" />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formData.unit !== 'unit' && (
              <div className="space-y-2">
                <Label htmlFor="unitValue">Contenido</Label>
                <Input
                  id="unitValue"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.unitValue}
                  onChange={(e) => setFormData((prev) => ({ ...prev, unitValue: e.target.value }))}
                  placeholder={`Ej: 2.25`}
                />
              </div>
            )}
          </div>

          {/* Secondary unit */}
          <div className={cn('grid gap-3', formData.secondaryUnit ? 'grid-cols-2' : 'grid-cols-1')}>
            <div className="space-y-2">
              <Label>Segunda unidad de medida</Label>
              <Select
                value={formData.secondaryUnit || 'none'}
                onValueChange={(value) => {
                  const nextUnit = value === 'none' ? '' : value;
                  setFormData((prev) => {
                    const nextValue = nextUnit === 'dozen'
                      ? '12'
                      : nextUnit
                        ? (prev.secondaryUnit === 'dozen' ? '' : prev.secondaryUnitValue)
                        : '';
                    return {
                      ...prev,
                      secondaryUnit: nextUnit,
                      secondaryUnitValue: nextValue,
                    };
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin segunda unidad" />
                </SelectTrigger>
                <SelectContent>
                  {SECONDARY_UNIT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formData.secondaryUnit && formData.secondaryUnit !== 'dozen' && (
              <div className="space-y-2">
                <Label htmlFor="secondaryUnitValue">Cantidad</Label>
                <Input
                  id="secondaryUnitValue"
                  type="number"
                  min="0"
                  step="1"
                  value={formData.secondaryUnitValue}
                  onChange={(e) => setFormData((prev) => ({ ...prev, secondaryUnitValue: e.target.value }))}
                  placeholder="Ej: 6"
                />
              </div>
            )}
            {formData.secondaryUnit === 'dozen' && (
              <div className="space-y-2">
                <Label htmlFor="secondaryUnitValue">Cantidad</Label>
                <Input
                  id="secondaryUnitValue"
                  value={formData.secondaryUnitValue || '12'}
                  disabled
                />
              </div>
            )}
          </div>

          {/* Name preview */}
          {formData.name && (primarySuffix || secondarySuffix) && (
            <p className="text-xs text-muted-foreground -mt-2">
              Se mostrará como: <span className="font-medium text-foreground">{previewName}</span>
            </p>
          )}

          {/* Price & Stock */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="price">Precio *</Label>
              <Input
                id="price"
                type="number"
                min="0"
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData((prev) => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">Stock</Label>
              <Input
                id="quantity"
                type="number"
                min="0"
                value={formData.quantity}
                onChange={(e) => setFormData((prev) => ({ ...prev, quantity: parseInt(e.target.value) || 0 }))}
                placeholder="0"
              />
            </div>
          </div>

          {/* Categories */}
          <div className="space-y-2">
            <Label>Categorías</Label>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                    formData.categoryIds.includes(category.id)
                      ? 'bg-primary/20 text-primary ring-1 ring-primary/30'
                      : 'bg-secondary text-muted-foreground hover:bg-accent'
                  )}
                  style={
                    formData.categoryIds.includes(category.id) && category.color
                      ? { backgroundColor: `${category.color}20`, color: category.color, boxShadow: `inset 0 0 0 1px ${category.color}40` }
                      : undefined
                  }
                >
                  {category.name}
                </button>
              ))}
              {!isCreatingCategory && (
                <button
                  type="button"
                  onClick={() => setIsCreatingCategory(true)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-secondary text-muted-foreground hover:bg-accent flex items-center gap-1.5 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  Nueva
                </button>
              )}
            </div>
          {isCreatingCategory && (
              <div className="flex gap-2 mt-2">
                <input
                  type="color"
                  value={newCategoryColor}
                  onChange={(e) => setNewCategoryColor(e.target.value)}
                  className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent"
                />
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Nombre de categoría"
                  className="flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCreateCategory();
                    }
                    if (e.key === 'Escape') {
                      setIsCreatingCategory(false);
                      setNewCategoryName('');
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreateCategory}
                  disabled={!newCategoryName.trim()}
                >
                  Agregar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsCreatingCategory(false);
                    setNewCategoryName('');
                  }}
                >
                  Cancelar
                </Button>
              </div>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Descripción del producto..."
              rows={3}
            />
          </div>
        </form>

        <div className="flex gap-3 w-full pt-4 border-t border-border">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={isLoading}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={handleSubmit} isLoading={isLoading}>
            {product ? 'Guardar cambios' : 'Crear producto'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
