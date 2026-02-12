import { Search, CheckSquare, X, LayoutGrid, List } from 'lucide-react';
import { Input, Button } from '../ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

interface Category {
  id: string;
  name: string;
  productCount?: number;
}

interface StockFiltersProps {
  search: string;
  onSearchChange: (search: string) => void;
  selectedCategory: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  categories: Category[];
  stockFilter: 'all' | 'inStock' | 'lowStock' | 'outOfStock';
  onStockFilterChange: (filter: 'all' | 'inStock' | 'lowStock' | 'outOfStock') => void;
  isSelectMode: boolean;
  onSelectModeToggle: () => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
}

export function StockFilters({
  search,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  categories,
  stockFilter,
  onStockFilterChange,
  isSelectMode,
  onSelectModeToggle,
  viewMode,
  onViewModeChange,
}: StockFiltersProps) {
  const stockFilterOptions = [
    { value: 'all', label: 'Todos' },
    { value: 'inStock', label: 'Con stock' },
    { value: 'lowStock', label: 'Stock bajo' },
    { value: 'outOfStock', label: 'Sin stock' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar productos..."
          className="pl-10"
        />
      </div>

      {/* Category filter */}
      <Select
        value={selectedCategory || 'all'}
        onValueChange={(value) => onCategoryChange(value === 'all' ? null : value)}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Todas las categorías" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las categorías</SelectItem>
          {categories.map((cat) => (
            <SelectItem key={cat.id} value={cat.id}>
              {cat.name} {cat.productCount !== undefined && `(${cat.productCount})`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Stock filter */}
      <div className="flex rounded-xl overflow-hidden border border-border">
        {stockFilterOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => onStockFilterChange(option.value as 'all' | 'inStock' | 'lowStock' | 'outOfStock')}
            className={`px-3.5 py-2.5 text-sm font-medium transition-all ${
              stockFilter === option.value
                ? 'bg-primary/20 text-primary'
                : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* View mode toggle */}
      <div className="flex rounded-xl overflow-hidden border border-border">
        <button
          onClick={() => onViewModeChange('grid')}
          className={`px-3.5 py-2.5 text-sm font-medium transition-all ${
            viewMode === 'grid'
              ? 'bg-primary/20 text-primary'
              : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
          title="Vista tarjetas"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
        <button
          onClick={() => onViewModeChange('list')}
          className={`px-3.5 py-2.5 text-sm font-medium transition-all ${
            viewMode === 'list'
              ? 'bg-primary/20 text-primary'
              : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
          title="Vista lista"
        >
          <List className="w-4 h-4" />
        </button>
      </div>

      {/* Select mode toggle */}
      <Button
        variant={isSelectMode ? 'secondary' : 'outline'}
        size="sm"
        onClick={onSelectModeToggle}
        className={isSelectMode ? 'bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30' : ''}
      >
        {isSelectMode ? (
          <>
            <X className="w-4 h-4 mr-1" />
            Cancelar
          </>
        ) : (
          <>
            <CheckSquare className="w-4 h-4 mr-1" />
            Seleccionar
          </>
        )}
      </Button>
    </div>
  );
}
