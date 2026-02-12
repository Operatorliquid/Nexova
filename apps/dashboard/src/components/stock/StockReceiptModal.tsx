import { useMemo, useRef, useState } from 'react';
import { FileUp, ReceiptText, CheckCircle2, AlertTriangle, Upload, Info } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui';
import { useToast } from '../../stores/toast.store';

const API_URL = import.meta.env.VITE_API_URL || '';

const fetchWithCredentials = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
  ...init,
  credentials: 'include',
});

type PreviewItem = {
  id: string;
  description: string;
  quantity: number;
  isPack: boolean;
  unitsPerPack: number | null;
  quantityBaseUnits: number;
  matchedProductId: string | null;
  matchedProductName: string | null;
  suggestedProductName: string | null;
  suggestedProductUnit: 'unit' | 'kg' | 'g' | 'l' | 'ml' | 'm' | 'cm' | null;
  suggestedProductUnitValue: string | null;
  matchConfidence: number | null;
};

type EditablePreviewItem = PreviewItem & {
  suggestedProductName: string | null;
  suggestedProductUnit: 'unit' | 'kg' | 'g' | 'l' | 'ml' | 'm' | 'cm' | null;
  suggestedProductUnitValue: string | null;
  forceCreateProduct: boolean;
};

type PreviewResponse =
  | { duplicate: true; receiptId: string; status: string }
  | {
      duplicate: false;
      receipt: {
        id: string;
        status: string;
        vendorName: string | null;
        issuedAt: string | null;
        total: number;
        currency: string;
        fileRef: string;
        fileHash: string;
        createdAt: string;
      };
      items: PreviewItem[];
    };

type ApplyResponse = {
  success: boolean;
  receipt: {
    id: string;
    status: string;
    vendorName: string | null;
    issuedAt: string | null;
    total: number;
    currency: string;
    fileRef: string;
    appliedAt: string | null;
  };
  createdProducts: Array<{ id: string; name: string; sku: string }>;
  stockAdjustments: Array<{ productId: string; productName: string; delta: number; previousQty: number; newQty: number }>;
};

const PRIMARY_UNIT_OPTIONS: Array<{ value: 'unit' | 'kg' | 'g' | 'l' | 'ml' | 'm' | 'cm'; label: string }> = [
  { value: 'unit', label: 'Unidad' },
  { value: 'kg', label: 'Kg' },
  { value: 'g', label: 'Gr' },
  { value: 'l', label: 'L' },
  { value: 'ml', label: 'Ml' },
  { value: 'm', label: 'M' },
  { value: 'cm', label: 'Cm' },
];

function computeBaseUnits(quantity: number, isPack: boolean, unitsPerPack: number | null): number {
  const safeQty = Number.isFinite(quantity) ? Math.max(0, Math.trunc(quantity)) : 0;
  if (!isPack) return safeQty;
  const safeUnitsPerPack = Number.isFinite(unitsPerPack || 0) ? Math.max(1, Math.trunc(unitsPerPack || 1)) : 1;
  return safeQty * safeUnitsPerPack;
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function StockReceiptModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onApplied?: () => void;
}) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [editableItems, setEditableItems] = useState<EditablePreviewItem[]>([]);
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isApplyLoading, setIsApplyLoading] = useState(false);

  const receiptId = preview && !preview.duplicate ? preview.receipt.id : null;

  const needsAttention = useMemo(() => {
    if (!preview || preview.duplicate) return false;
    const source = editableItems.length > 0 ? editableItems : preview.items;
    return source.some((it) => !it.matchedProductId || (typeof it.matchConfidence === 'number' && it.matchConfidence < 0.7));
  }, [preview, editableItems]);

  const resetState = () => {
    setFile(null);
    setPreview(null);
    setEditableItems([]);
    setApplyResult(null);
    setIsPreviewLoading(false);
    setIsApplyLoading(false);
  };

  const updateEditableItem = (itemId: string, updater: (prev: EditablePreviewItem) => EditablePreviewItem) => {
    setEditableItems((prev) => prev.map((item) => (item.id === itemId ? updater(item) : item)));
  };

  const handleClose = (nextOpen: boolean) => {
    props.onOpenChange(nextOpen);
    if (!nextOpen) {
      resetState();
    }
  };

  const handlePreview = async () => {
    if (!file) return;
    setIsPreviewLoading(true);
    setApplyResult(null);

    try {
      const form = new FormData();
      form.append('file', file);

      const res = await fetchWithCredentials(`${API_URL}/api/v1/stock-receipts/preview`, {
        method: 'POST',
        headers: {
          'X-Workspace-Id': props.workspaceId,
        },
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err?.message || err?.error || 'Error al procesar boleta';
        toast.error(message);
        return;
      }

      const data = (await res.json()) as PreviewResponse;
      setPreview(data);
      setEditableItems(
        data.duplicate
          ? []
          : data.items.map((item) => ({
              ...item,
              suggestedProductUnit: item.suggestedProductUnit || 'unit',
              suggestedProductUnitValue: item.suggestedProductUnitValue || null,
              forceCreateProduct: false,
            }))
      );

      if (data.duplicate) {
        toast.info('Esta boleta ya fue procesada anteriormente.');
      } else {
        toast.success('Boleta leída. Revisá el resumen y aplicá al stock.');
      }
    } catch (error) {
      console.error('Failed to preview receipt:', error);
      toast.error('Error al procesar boleta');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleApply = async () => {
    if (!receiptId) return;
    setIsApplyLoading(true);
    try {
      const res = await fetchWithCredentials(`${API_URL}/api/v1/stock-receipts/${receiptId}/apply`, {
        method: 'POST',
        headers: {
          'X-Workspace-Id': props.workspaceId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: editableItems.map((item) => ({
            id: item.id,
            description: item.description,
            quantity: item.quantity,
            isPack: item.isPack,
            unitsPerPack: item.isPack ? (item.unitsPerPack || 1) : null,
            matchedProductId: item.forceCreateProduct ? null : item.matchedProductId,
            forceCreateProduct: item.forceCreateProduct,
            suggestedProductName: item.suggestedProductName || null,
            suggestedProductUnit: item.suggestedProductUnit || null,
            suggestedProductUnitValue: item.suggestedProductUnitValue || null,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err?.message || err?.error || 'Error al aplicar boleta';
        toast.error(message);
        return;
      }

      const data = (await res.json()) as ApplyResponse;
      setApplyResult(data);
      toast.success('Stock actualizado desde la boleta.');
      props.onApplied?.();
    } catch (error) {
      console.error('Failed to apply receipt:', error);
      toast.error('Error al aplicar boleta');
    } finally {
      setIsApplyLoading(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader className="pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <ReceiptText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Cargar boleta para stock</DialogTitle>
              <DialogDescription>
                Subí una foto o PDF. Vamos a leer los productos, cantidades y actualizar el inventario.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Step 1: Upload */}
        {!preview && !applyResult && (
          <>
            <div className="flex-1 overflow-y-auto space-y-5 py-4 px-1 -mx-1">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-secondary/30 border border-border">
                <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Cuanto más nítida la foto, mejor precisión (ideal: boleta completa, sin recortes).
                </p>
              </div>

              <div className="space-y-2">
                <Label>Archivo</Label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="relative flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-border hover:border-primary/50 bg-secondary/20 cursor-pointer transition-all group"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <Upload className="w-6 h-6 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">
                      {file ? file.name : 'Hacé click para seleccionar'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {file
                        ? `${Math.round(file.size / 1024)} KB`
                        : 'Imagen o PDF de la boleta'}
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </div>
                {file && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileUp className="w-4 h-4" />
                    <span>{file.name}</span>
                    <span>({Math.round(file.size / 1024)} KB)</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 w-full pt-4 border-t border-border">
              <Button variant="secondary" className="flex-1" onClick={() => handleClose(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={handlePreview} disabled={!file} isLoading={isPreviewLoading}>
                Analizar boleta
              </Button>
            </div>
          </>
        )}

        {/* Duplicate warning */}
        {preview && preview.duplicate && (
          <>
            <div className="flex-1 overflow-y-auto space-y-5 py-4 px-1 -mx-1">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Boleta repetida</p>
                  <p className="text-sm text-muted-foreground">
                    Ya existe una boleta con el mismo archivo. No se aplicó al stock.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 w-full pt-4 border-t border-border">
              <Button className="flex-1" onClick={() => handleClose(false)}>Cerrar</Button>
            </div>
          </>
        )}

        {/* Step 2: Preview & Edit */}
        {preview && !preview.duplicate && !applyResult && (
          <>
            <div className="flex-1 overflow-y-auto space-y-5 py-4 px-1 -mx-1">
              {/* Receipt summary */}
              <div className="rounded-2xl border border-border bg-secondary/30 p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {preview.receipt.vendorName || 'Proveedor'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Fecha: {formatDate(preview.receipt.issuedAt || preview.receipt.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="text-lg font-semibold text-foreground">{formatCurrency(preview.receipt.total)}</p>
                  </div>
                </div>
                {needsAttention && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
                    <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-200/90">
                      Algunos items tienen baja confianza o no se pudieron matchear. Al aplicar, se crearán productos en borrador si hace falta.
                    </p>
                  </div>
                )}
              </div>

              {/* Items list */}
              <div className="rounded-2xl border border-border overflow-hidden">
                <div className="px-4 py-3 bg-secondary/40 border-b border-border">
                  <p className="text-sm font-semibold text-foreground">Items detectados</p>
                  <p className="text-xs text-muted-foreground mt-1">Podés corregir todo manualmente (descripción, match, cantidad y formato) antes de aplicar.</p>
                </div>
                <div className="divide-y divide-border">
                  {editableItems.map((item) => (
                    <div key={item.id} className="px-4 py-3 flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="space-y-3">
                          {/* Description */}
                          <div className="space-y-2">
                            <Label>Descripción</Label>
                            <Input
                              value={item.description}
                              onChange={(e) => {
                                const value = e.target.value.slice(0, 500);
                                updateEditableItem(item.id, (prev) => ({ ...prev, description: value }));
                              }}
                            />
                          </div>

                          {/* Force create checkbox */}
                          {item.matchedProductId && (
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={item.forceCreateProduct}
                                onCheckedChange={(checked) => {
                                  const forceCreateProduct = Boolean(checked);
                                  updateEditableItem(item.id, (prev) => ({
                                    ...prev,
                                    forceCreateProduct,
                                    suggestedProductName: forceCreateProduct
                                      ? (prev.suggestedProductName || prev.description)
                                      : prev.suggestedProductName,
                                  }));
                                }}
                              />
                              <Label className="text-xs text-muted-foreground font-normal">
                                Ignorar match y crear producto nuevo
                              </Label>
                            </div>
                          )}

                          {/* Suggested product name */}
                          <div className="space-y-2">
                            <Label>Nombre del producto a crear/corregir</Label>
                            <Input
                              value={item.suggestedProductName || ''}
                              onChange={(e) => {
                                const value = e.target.value.slice(0, 255);
                                updateEditableItem(item.id, (prev) => ({
                                  ...prev,
                                  suggestedProductName: value || null,
                                  forceCreateProduct: prev.matchedProductId ? true : prev.forceCreateProduct,
                                }));
                              }}
                              placeholder="Nombre del producto a crear/corregir"
                            />
                          </div>

                          {/* Unit + value */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label>Unidad</Label>
                              <Select
                                value={item.suggestedProductUnit || 'unit'}
                                onValueChange={(value) => {
                                  const unit = value as EditablePreviewItem['suggestedProductUnit'];
                                  updateEditableItem(item.id, (prev) => ({
                                    ...prev,
                                    suggestedProductUnit: unit,
                                    suggestedProductUnitValue: unit === 'unit' ? null : prev.suggestedProductUnitValue,
                                    forceCreateProduct: prev.matchedProductId ? true : prev.forceCreateProduct,
                                  }));
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {PRIMARY_UNIT_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>Medida</Label>
                              <Input
                                value={item.suggestedProductUnitValue || ''}
                                onChange={(e) => {
                                  const value = e.target.value.slice(0, 32);
                                  updateEditableItem(item.id, (prev) => ({
                                    ...prev,
                                    suggestedProductUnitValue: value || null,
                                    forceCreateProduct: prev.matchedProductId ? true : prev.forceCreateProduct,
                                  }));
                                }}
                                placeholder="Ej: 250"
                                disabled={(item.suggestedProductUnit || 'unit') === 'unit'}
                              />
                            </div>
                          </div>

                          {/* Quantity + pack */}
                          <div className="flex items-end gap-3 flex-wrap">
                            <div className="space-y-2">
                              <Label>Cantidad</Label>
                              <Input
                                type="number"
                                min={1}
                                value={item.quantity}
                                onChange={(e) => {
                                  const next = Math.max(1, Number(e.target.value || '1'));
                                  updateEditableItem(item.id, (prev) => ({ ...prev, quantity: next }));
                                }}
                                className="w-24"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Formato</Label>
                              <Select
                                value={item.isPack ? 'pack' : 'unit'}
                                onValueChange={(value) => {
                                  const isPack = value === 'pack';
                                  updateEditableItem(item.id, (prev) => ({
                                    ...prev,
                                    isPack,
                                    unitsPerPack: isPack ? (prev.unitsPerPack || 1) : null,
                                  }));
                                }}
                              >
                                <SelectTrigger className="w-28">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unit">Unidad</SelectItem>
                                  <SelectItem value="pack">Bulto</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            {item.isPack && (
                              <div className="space-y-2">
                                <Label>Uds/bulto</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  value={item.unitsPerPack || 1}
                                  onChange={(e) => {
                                    const next = Math.max(1, Number(e.target.value || '1'));
                                    updateEditableItem(item.id, (prev) => ({ ...prev, unitsPerPack: next }));
                                  }}
                                  className="w-24"
                                />
                              </div>
                            )}
                          </div>

                          {/* Badges */}
                          <div className="flex items-center gap-2 flex-wrap">
                            {item.forceCreateProduct ? (
                              <Badge variant="secondary">Crear: {item.suggestedProductName || item.description}</Badge>
                            ) : item.matchedProductName ? (
                              <Badge variant="default">Match: {item.matchedProductName}</Badge>
                            ) : item.suggestedProductName ? (
                              <Badge variant="secondary">Crear: {item.suggestedProductName}</Badge>
                            ) : (
                              <Badge variant="secondary">Crear producto</Badge>
                            )}
                            {typeof item.matchConfidence === 'number' && (
                              <Badge variant="secondary">Conf: {Math.round(item.matchConfidence * 100)}%</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right whitespace-nowrap pt-6">
                        <p className="text-xs text-muted-foreground">Ajuste</p>
                        <p className="text-sm font-semibold text-foreground">
                          +{computeBaseUnits(item.quantity, item.isPack, item.unitsPerPack)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 w-full pt-4 border-t border-border">
              <Button variant="secondary" className="flex-1" onClick={() => handleClose(false)} disabled={isApplyLoading}>
                Cerrar
              </Button>
              <Button className="flex-1" onClick={handleApply} isLoading={isApplyLoading}>
                Aplicar al stock
              </Button>
            </div>
          </>
        )}

        {/* Step 3: Applied result */}
        {applyResult && (
          <>
            <div className="flex-1 overflow-y-auto space-y-5 py-4 px-1 -mx-1">
              <div className="flex items-start gap-3 p-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Stock actualizado</p>
                  <p className="text-sm text-muted-foreground">
                    Total boleta: {formatCurrency(applyResult.receipt.total)}. Ajustes: {applyResult.stockAdjustments.length}.
                  </p>
                </div>
              </div>

              {applyResult.createdProducts.length > 0 && (
                <div className="rounded-2xl border border-border p-4">
                  <p className="text-sm font-semibold text-foreground">Productos creados</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Se crearon como borrador. No te olvides de completar categoría, unidades y precio de venta.
                  </p>
                  <div className="mt-3 space-y-2">
                    {applyResult.createdProducts.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-4">
                        <span className="text-sm text-foreground truncate">{p.name}</span>
                        <Badge variant="secondary">{p.sku}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 w-full pt-4 border-t border-border">
              <Button className="flex-1" onClick={() => handleClose(false)}>Cerrar</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
