import { Package, MoreVertical, Edit, Trash2, Tags } from 'lucide-react';
import {
  Badge,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Category {
  id: string;
  name: string;
  color?: string | null;
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

interface Product {
  id: string;
  name: string;
  sku: string;
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
}

interface ProductCardProps {
  product: Product;
  isSelected: boolean;
  isSelectMode: boolean;
  onSelect: (selected: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddCategory: () => void;
}

export function ProductCard({
  product,
  isSelected,
  isSelectMode,
  onSelect,
  onEdit,
  onDelete,
  onAddCategory,
}: ProductCardProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(price / 100);
  };

  const getStockVariant = () => {
    if (product.isOutOfStock) return 'destructive';
    if (product.isLowStock) return 'warning';
    return 'success';
  };

  // Handle both relative and absolute URLs
  const rawImageUrl = product.images?.[0];
  const imageUrl = rawImageUrl?.startsWith('/') ? `${API_URL}${rawImageUrl}` : rawImageUrl;

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('label') || target.closest('[role="menu"]')) {
      return;
    }
    if (isSelectMode) {
      onSelect(!isSelected);
      return;
    }
    onEdit();
  };

  const primaryValue = product.unitValue?.toString();
  const secondaryValue = product.secondaryUnitValue?.toString();
  const primaryBadge = product.unit && product.unit !== 'unit' && primaryValue
    ? `${primaryValue} ${UNIT_SHORT_LABELS[product.unit] || product.unit}`
    : null;
  const secondaryLabel = product.secondaryUnit ? (SECONDARY_UNIT_LABELS[product.secondaryUnit] || product.secondaryUnit) : '';
  const secondaryBadge = product.secondaryUnit
    ? secondaryValue
      ? `${secondaryLabel} ${secondaryValue}`.trim()
      : secondaryLabel
    : null;

  return (
    <div
      onClick={handleCardClick}
      className={`group glass-card rounded-2xl overflow-hidden transition-all duration-300 cursor-pointer hover:border-border/50 hover:shadow-xl ${
        isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
      }`}
    >
      {/* Image or placeholder */}
      <div className="relative h-40 bg-muted/30 overflow-hidden">
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
          <div className="w-full h-full flex items-center justify-center bg-muted/20">
            <Package className="w-12 h-12 text-muted-foreground/40" />
          </div>
        )}

        {/* Select checkbox */}
        {isSelectMode && (
          <div className="absolute top-3 left-3 z-10">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-black/40 backdrop-blur-sm">
              <Checkbox
                checked={isSelected}
                onCheckedChange={onSelect}
                className="border-white/60 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
              />
            </div>
          </div>
        )}

        {/* Menu button */}
        <div className="absolute top-3 right-3 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-2 rounded-lg bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors">
                <MoreVertical className="w-4 h-4 text-white" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onAddCategory}>
                <Tags className="w-4 h-4" />
                Agregar categoría
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <Edit className="w-4 h-4" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem destructive onClick={onDelete}>
                <Trash2 className="w-4 h-4" />
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Stock badge */}
        <div className="absolute bottom-3 right-3">
          <Badge variant={getStockVariant()}>
            {product.isOutOfStock ? 'Sin stock' : `${product.stock} uds`}
          </Badge>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground truncate">
              {product.name}
              {(primaryBadge || secondaryBadge) && (
                <span className="ml-2 inline-flex items-center gap-1">
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
            </h3>
            <p className="text-xs text-muted-foreground font-mono">{product.sku}</p>
          </div>
          <p className="font-bold text-lg text-foreground shrink-0">{formatPrice(product.price)}</p>
        </div>

        {/* Categories */}
        {product.categories && product.categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
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
        )}
      </div>
    </div>
  );
}
