-- Оригинал загруженного файла на диске (<UPLOAD_DIR>/<storageKey>); старые записи без файла — NULL.
ALTER TABLE "Upload" ADD COLUMN "storageKey" TEXT;
