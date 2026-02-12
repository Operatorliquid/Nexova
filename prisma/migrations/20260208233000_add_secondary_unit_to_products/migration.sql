-- Add secondary unit fields to products
ALTER TABLE "products"
ADD COLUMN "secondary_unit" VARCHAR(20),
ADD COLUMN "secondary_unit_value" VARCHAR(20);

-- Migrate legacy pack/box/dozen units into secondary unit fields
UPDATE "products"
SET
  "secondary_unit" = "unit",
  "secondary_unit_value" = CASE
    WHEN "unit" = 'dozen' THEN COALESCE("unit_value", '12')
    ELSE "unit_value"
  END,
  "unit" = 'unit',
  "unit_value" = NULL
WHERE "unit" IN ('pack', 'box', 'dozen');
