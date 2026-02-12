import { AlertTriangle } from 'lucide-react';
import { Button, Dialog, DialogContent } from '../ui';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  message: string;
  itemCount?: number;
  isLoading?: boolean;
}

export function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  itemCount,
  isLoading,
}: DeleteConfirmModalProps) {
  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <div className="flex flex-col items-center text-center pt-2">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
          <p className="text-muted-foreground text-sm mb-1">{message}</p>
          {itemCount && itemCount > 1 && (
            <p className="text-xs text-muted-foreground/60">
              Se eliminarán {itemCount} elementos
            </p>
          )}
        </div>
        <div className="flex gap-3 w-full">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={isLoading}>
            Cancelar
          </Button>
          <Button variant="destructive" className="flex-1" onClick={handleConfirm} isLoading={isLoading}>
            Eliminar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
