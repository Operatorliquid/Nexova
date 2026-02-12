/**
 * Database Seed Script
 * Creates initial data: super admin, demo workspace, sample products
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { encrypt } from '@nexova/core';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Create Super Admin User
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('Creating super admin user...');

  const adminPassword = await argon2.hash('admin123', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@nexova.com' },
    update: {},
    create: {
      email: 'admin@nexova.com',
      passwordHash: adminPassword,
      firstName: 'Super',
      lastName: 'Admin',
      status: 'active',
      isSuperAdmin: true,
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`  ✓ Super admin: ${superAdmin.email} (password: admin123)`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Create System Settings
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nCreating system settings...');

  await prisma.systemSettings.upsert({
    where: { id: 'system' },
    update: {},
    create: {
      id: 'system',
      defaultLlmModel: 'claude-sonnet-4-20250514',
      maintenanceMode: false,
    },
  });
  console.log('  ✓ System settings initialized');

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Create Demo Workspace
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nCreating demo workspace...');

  const workspace = await prisma.workspace.upsert({
    where: { slug: 'demo-store' },
    update: {},
    create: {
      name: 'Demo Store',
      slug: 'demo-store',
      phone: '+5491155550000',
      plan: 'professional',
      status: 'active',
      settings: {
        currency: 'ARS',
        timezone: 'America/Argentina/Buenos_Aires',
        language: 'es',
      },
    },
  });
  console.log(`  ✓ Workspace: ${workspace.name} (/${workspace.slug})`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Create Roles for Workspace
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nCreating roles...');

  const ownerRole = await prisma.role.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'Owner' } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: 'Owner',
      description: 'Full access to all workspace features',
      isSystem: true,
      permissions: ['*'],
    },
  });
  console.log('  ✓ Role: Owner');

  const adminRole = await prisma.role.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'Admin' } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: 'Admin',
      description: 'Full access except billing and workspace deletion',
      isSystem: true,
      permissions: [
        'dashboard:read',
        'sessions:read', 'sessions:takeover', 'sessions:message', 'sessions:release',
        'handoffs:read', 'handoffs:claim', 'handoffs:resolve',
        'orders:*', 'products:*', 'stock:*', 'customers:*', 'payments:*',
        'analytics:read',
        'settings:read', 'settings:update',
        'members:*', 'connections:*',
        'audit:read', 'audit:export',
      ],
    },
  });
  console.log('  ✓ Role: Admin');

  const basicRole = await prisma.role.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'Basic' } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: 'Basic',
      description: 'Plan basico de comercio con acceso de lectura',
      isSystem: false,
      permissions: [
        'dashboard:read',
        'sessions:read',
        'orders:read',
        'products:read',
        'stock:read',
        'customers:read',
        'payments:read',
        'analytics:read',
      ],
    },
  });
  console.log('  ✓ Role: Basic');

  const standardRole = await prisma.role.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'Standard' } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: 'Standard',
      description: 'Plan standard de comercio con operacion diaria',
      isSystem: false,
      permissions: [
        'dashboard:read',
        'sessions:read', 'sessions:takeover', 'sessions:message', 'sessions:release',
        'handoffs:read', 'handoffs:claim', 'handoffs:resolve',
        'orders:read', 'orders:create', 'orders:update',
        'products:read',
        'stock:read',
        'customers:read', 'customers:update',
        'payments:read', 'payments:create',
        'analytics:read',
      ],
    },
  });
  console.log('  ✓ Role: Standard');

  await prisma.role.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'Pro' } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: 'Pro',
      description: 'Plan pro de comercio con gestion avanzada',
      isSystem: false,
      permissions: [
        'dashboard:read',
        'sessions:read', 'sessions:takeover', 'sessions:message', 'sessions:release',
        'handoffs:read', 'handoffs:claim', 'handoffs:resolve',
        'orders:*',
        'products:*',
        'stock:*',
        'customers:*',
        'payments:*',
        'analytics:read',
        'settings:read',
      ],
    },
  });
  console.log('  ✓ Role: Pro');

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Add Super Admin to Workspace
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nAdding super admin to workspace...');

  await prisma.membership.upsert({
    where: {
      userId_workspaceId: {
        userId: superAdmin.id,
        workspaceId: workspace.id,
      },
    },
    update: {},
    create: {
      userId: superAdmin.id,
      workspaceId: workspace.id,
      roleId: ownerRole.id,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });
  console.log('  ✓ Super admin added as Owner');

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Create Demo User
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nCreating demo user...');

  const demoPassword = await argon2.hash('demo123', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: {
      email: 'demo@example.com',
      passwordHash: demoPassword,
      firstName: 'Demo',
      lastName: 'User',
      status: 'active',
      isSuperAdmin: false,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_workspaceId: {
        userId: demoUser.id,
        workspaceId: workspace.id,
      },
    },
    update: {},
    create: {
      userId: demoUser.id,
      workspaceId: workspace.id,
      roleId: standardRole.id,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });
  console.log(`  ✓ Demo user: ${demoUser.email} (password: demo123)`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Create Sample Products
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nCreating sample products...');

  const products = [
    {
      sku: 'REM-001',
      name: 'Remera Básica',
      description: 'Remera de algodón 100%, corte clásico',
      shortDesc: 'Remera algodón',
      category: 'Remeras',
      price: 5000,
      status: 'ACTIVE',
    },
    {
      sku: 'REM-002',
      name: 'Remera Premium',
      description: 'Remera de algodón pima, acabado premium',
      shortDesc: 'Remera premium',
      category: 'Remeras',
      price: 8500,
      status: 'ACTIVE',
    },
    {
      sku: 'JEA-001',
      name: 'Jean Slim Fit',
      description: 'Jean de denim premium, corte slim',
      shortDesc: 'Jean slim',
      category: 'Pantalones',
      price: 12000,
      status: 'ACTIVE',
    },
    {
      sku: 'CAM-001',
      name: 'Campera de Cuero',
      description: 'Campera de cuero genuino, forro interior',
      shortDesc: 'Campera cuero',
      category: 'Abrigos',
      price: 35000,
      status: 'ACTIVE',
    },
    {
      sku: 'ZAP-001',
      name: 'Zapatillas Running',
      description: 'Zapatillas deportivas con amortiguación',
      shortDesc: 'Zapatillas running',
      category: 'Calzado',
      price: 28000,
      status: 'ACTIVE',
    },
  ];

  for (const product of products) {
    const created = await prisma.product.upsert({
      where: { workspaceId_sku: { workspaceId: workspace.id, sku: product.sku } },
      update: {},
      create: {
        workspaceId: workspace.id,
        ...product,
      },
    });

    // Create stock item (use findFirst + create to handle null in unique constraint)
    const existingStock = await prisma.stockItem.findFirst({
      where: {
        productId: created.id,
        variantId: null,
        location: null,
      },
    });

    if (!existingStock) {
      await prisma.stockItem.create({
        data: {
          productId: created.id,
          quantity: Math.floor(Math.random() * 50) + 10,
          reserved: 0,
          lowThreshold: 5,
        },
      });
    }

    console.log(`  ✓ Product: ${product.name} (${product.sku})`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Create WhatsApp Number (using env variables for credentials)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nCreating WhatsApp number...');

  const infobipApiKey = process.env.INFOBIP_API_KEY;
  const infobipBaseUrl = process.env.INFOBIP_BASE_URL || 'https://api.infobip.com';

  if (infobipApiKey) {
    if (!process.env.ENCRYPTION_KEY) {
      console.log('  ⚠ ENCRYPTION_KEY not set, skipping WhatsApp number creation');
    } else {
      const encrypted = encrypt(infobipApiKey);

      const whatsappNumber = await prisma.whatsAppNumber.upsert({
        where: { phoneNumber: '+5491155550000' },
        update: {},
        create: {
          phoneNumber: '+5491155550000',
          displayName: 'Demo WhatsApp',
          provider: 'infobip',
          apiKeyEnc: encrypted.encrypted,
          apiKeyIv: encrypted.iv,
          apiUrl: infobipBaseUrl,
          status: 'assigned',
          isActive: true,
          workspaceId: workspace.id,
        },
      });
      console.log(`  ✓ WhatsApp Number: ${whatsappNumber.phoneNumber}`);
      console.log(`    Webhook URL: /api/v1/webhooks/infobip/${whatsappNumber.id}`);
    }
  } else {
    console.log('  ⚠ INFOBIP_API_KEY not set, skipping WhatsApp number creation');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Create Sample Customer
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nCreating sample customer...');

  await prisma.customer.upsert({
    where: { workspaceId_phone: { workspaceId: workspace.id, phone: '+5491155551234' } },
    update: {},
    create: {
      workspaceId: workspace.id,
      phone: '+5491155551234',
      email: 'cliente@example.com',
      firstName: 'María',
      lastName: 'García',
      status: 'active',
    },
  });
  console.log('  ✓ Customer: María García');

  // ═══════════════════════════════════════════════════════════════════════════
  // Done!
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n✅ Seed completed successfully!\n');
  console.log('You can now login with:');
  console.log('  Super Admin: admin@nexova.com / admin123');
  console.log('  Demo User:   demo@example.com / demo123');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
