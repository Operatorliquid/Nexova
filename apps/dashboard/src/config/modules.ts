/**
 * Module Configuration
 * Defines available modules per business type
 * This is the single source of truth for navigation and features
 */

export interface Module {
  id: string;
  name: string;
  path: string;
  icon: string; // Icon name for dynamic rendering
  description?: string;
}

export interface BusinessTypeConfig {
  id: string;
  name: string;
  modules: string[]; // Module IDs
}

// All available modules in the system
export const modules: Record<string, Module> = {
  dashboard: {
    id: 'dashboard',
    name: 'Dashboard',
    path: '/',
    icon: 'dashboard',
    description: 'Vista general de tu negocio',
  },
  inbox: {
    id: 'inbox',
    name: 'Inbox',
    path: '/inbox',
    icon: 'inbox',
    description: 'Conversaciones con clientes',
  },
  orders: {
    id: 'orders',
    name: 'Pedidos',
    path: '/orders',
    icon: 'orders',
    description: 'Gestión de pedidos',
  },
  invoices: {
    id: 'invoices',
    name: 'Facturación',
    path: '/facturacion',
    icon: 'invoices',
    description: 'Emisión de facturas ARCA',
  },
  stock: {
    id: 'stock',
    name: 'Stock',
    path: '/stock',
    icon: 'stock',
    description: 'Control de inventario',
  },
  customers: {
    id: 'customers',
    name: 'Clientes',
    path: '/customers',
    icon: 'customers',
    description: 'Base de clientes',
  },
  metrics: {
    id: 'metrics',
    name: 'Métricas',
    path: '/metrics',
    icon: 'metrics',
    description: 'Resumen de ventas y clientes',
  },
  debts: {
    id: 'debts',
    name: 'Deudas',
    path: '/debts',
    icon: 'debts',
    description: 'Seguimiento de deudas',
  },
  // Booking modules (for future)
  bookings: {
    id: 'bookings',
    name: 'Reservas',
    path: '/bookings',
    icon: 'bookings',
    description: 'Gestión de reservas y turnos',
  },
  calendar: {
    id: 'calendar',
    name: 'Calendario',
    path: '/calendar',
    icon: 'calendar',
    description: 'Vista de calendario',
  },
  services: {
    id: 'services',
    name: 'Servicios',
    path: '/services',
    icon: 'services',
    description: 'Catálogo de servicios',
  },
  settings: {
    id: 'settings',
    name: 'Configuración',
    path: '/settings',
    icon: 'settings',
    description: 'Ajustes de tu cuenta',
  },
  quickActions: {
    id: 'quickActions',
    name: 'Quick Actions',
    path: '/quick-actions',
    icon: 'quickActions',
    description: 'Ejecutá acciones con comandos de texto',
  },
};

// Business type configurations
export const businessTypes: Record<string, BusinessTypeConfig> = {
  commerce: {
    id: 'commerce',
    name: 'Comercio',
    modules: ['dashboard', 'metrics', 'inbox', 'orders', 'invoices', 'stock', 'customers', 'debts', 'settings'],
  },
  bookings: {
    id: 'bookings',
    name: 'Manager de Bookings',
    modules: ['dashboard', 'metrics', 'inbox', 'bookings', 'calendar', 'customers', 'services', 'settings'],
  },
};

// Get modules for a business type
export function getModulesForBusinessType(businessType: string): Module[] {
  const config = businessTypes[businessType];
  if (!config) {
    // Default to commerce if not found
    return businessTypes.commerce.modules.map(id => modules[id]).filter(Boolean);
  }
  return config.modules.map(id => modules[id]).filter(Boolean);
}

// Check if a module is available for a business type
export function isModuleAvailable(moduleId: string, businessType: string): boolean {
  const config = businessTypes[businessType];
  if (!config) return false;
  return config.modules.includes(moduleId);
}
