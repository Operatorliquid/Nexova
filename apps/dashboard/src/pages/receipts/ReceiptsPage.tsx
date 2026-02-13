import { Button, Input, AnimatedPage, AnimatedStagger, AnimatedCard } from '../../components/ui';

export default function ReceiptsPage() {
  return (
    <div className="h-full overflow-y-auto scrollbar-hide p-6">
      <AnimatedPage className="max-w-7xl mx-auto space-y-6">
        {/* Header actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Input placeholder="Buscar comprobantes..." className="w-64" />
            <Button variant="outline" size="sm">
              Filtrar por tipo
            </Button>
            <Button variant="outline" size="sm">
              Filtrar por fecha
            </Button>
          </div>
          <Button>
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Nuevo comprobante
          </Button>
        </div>

        {/* Stats */}
        <AnimatedStagger className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { value: '0', label: 'Total comprobantes' },
            { value: '0', label: 'Este mes' },
            { value: '$0', label: 'Facturado' },
            { value: '0', label: 'Pendientes' },
          ].map((stat, i) => (
            <AnimatedCard key={i}>
              <div className="text-center">
                <p className="text-2xl font-bold text-muted-foreground">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </AnimatedCard>
          ))}
        </AnimatedStagger>

        {/* Receipts table - Empty state */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border">
            <h3 className="font-semibold text-foreground">Todos los comprobantes</h3>
          </div>
          <div className="p-5">
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-20 h-20 rounded-2xl bg-secondary flex items-center justify-center mb-6">
                <svg
                  className="w-10 h-10 text-muted-foreground/50"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium mb-2 text-foreground">No hay comprobantes</h3>
              <p className="text-muted-foreground max-w-sm">
                Los comprobantes se generan automaticamente con cada venta o puedes crearlos manualmente.
              </p>
              <Button className="mt-6">
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Crear comprobante
              </Button>
            </div>
          </div>
        </div>
      </AnimatedPage>
    </div>
  );
}
