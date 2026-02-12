-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "color" VARCHAR(7),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_category_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_category_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_categories_workspace_id_idx" ON "product_categories"("workspace_id");

-- CreateIndex
CREATE INDEX "product_categories_deleted_at_idx" ON "product_categories"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_workspace_id_name_key" ON "product_categories"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "product_category_mappings_product_id_idx" ON "product_category_mappings"("product_id");

-- CreateIndex
CREATE INDEX "product_category_mappings_category_id_idx" ON "product_category_mappings"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_category_mappings_product_id_category_id_key" ON "product_category_mappings"("product_id", "category_id");

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_category_mappings" ADD CONSTRAINT "product_category_mappings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_category_mappings" ADD CONSTRAINT "product_category_mappings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
