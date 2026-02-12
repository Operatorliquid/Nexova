import { useState } from 'react';
import { Plus, Trash2, Tags } from 'lucide-react';
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui';
import { DeleteConfirmModal } from './DeleteConfirmModal';

interface Category {
  id: string;
  name: string;
  color?: string | null;
  productCount?: number;
}

interface CategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  onCreateCategory: (name: string, color?: string) => Promise<Category | null>;
  onUpdateCategory: (categoryId: string, color: string) => Promise<void>;
  onDeleteCategory: (categoryId: string) => Promise<void>;
}

export function CategoriesModal({
  isOpen,
  onClose,
  categories,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
}: CategoriesModalProps) {
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#6366f1');
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newCategoryName.trim()) return;

    setIsCreating(true);
    try {
      await onCreateCategory(newCategoryName.trim(), newCategoryColor);
      setNewCategoryName('');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    setIsDeleting(true);
    try {
      await onDeleteCategory(deletingId);
    } finally {
      setIsDeleting(false);
      setDeletingId(null);
    }
  };

  const handleColorChange = async (categoryId: string, color: string) => {
    setUpdatingId(categoryId);
    try {
      await onUpdateCategory(categoryId, color);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader className="pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Tags className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Categorías</DialogTitle>
              <DialogDescription>Gestioná las categorías de tus productos</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Create new */}
        <div className="flex gap-2 pt-2">
          <input
            type="color"
            value={newCategoryColor}
            onChange={(e) => setNewCategoryColor(e.target.value)}
            className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent"
          />
          <Input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="Nueva categoría..."
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCreate();
              }
            }}
          />
          <Button onClick={handleCreate} isLoading={isCreating} disabled={!newCategoryName.trim()}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {/* Categories list */}
        <div className="flex-1 overflow-y-auto py-2">
          {categories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                <Tags className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <p className="text-muted-foreground">No hay categorías creadas</p>
              <p className="text-sm text-muted-foreground/50 mt-1">Creá una categoría para organizar tus productos</p>
            </div>
          ) : (
            <div className="space-y-2">
              {categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={category.color || '#6366f1'}
                      onChange={(e) => handleColorChange(category.id, e.target.value)}
                      disabled={updatingId === category.id}
                      className="w-4 h-4 rounded-full cursor-pointer border-0 bg-transparent disabled:opacity-60"
                      title="Cambiar color"
                    />
                    <span className="text-foreground font-medium">{category.name}</span>
                    {category.productCount !== undefined && (
                      <span className="text-xs text-muted-foreground">
                        {category.productCount} productos
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => setDeletingId(category.id)}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 w-full pt-4 border-t border-border">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </DialogContent>

      <DeleteConfirmModal
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDelete}
        title="Eliminar categoría"
        message={`¿Estás seguro de eliminar "${categories.find((c) => c.id === deletingId)?.name}"? Los productos no se eliminarán.`}
        isLoading={isDeleting}
      />
    </Dialog>
  );
}
