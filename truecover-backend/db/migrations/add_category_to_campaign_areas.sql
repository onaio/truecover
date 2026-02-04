-- ABOUTME: Migration to add category column to campaign areas
-- ABOUTME: Stores risk category assigned during stratified cluster sampling

ALTER TABLE campaign_areas
ADD COLUMN IF NOT EXISTS category TEXT;
