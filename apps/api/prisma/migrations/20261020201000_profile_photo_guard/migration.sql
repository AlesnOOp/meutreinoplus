-- The profile_photo enum value is committed by the previous migration.
-- PostgreSQL cannot use a newly added enum value in the same transaction.

CREATE FUNCTION "profile_photo_kind"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  asset_kind "MediaKind";
  asset_owner uuid;
BEGIN
  IF NEW."photo_asset_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "kind", "owner_user_id" INTO asset_kind, asset_owner
  FROM "media_assets"
  WHERE "id" = NEW."photo_asset_id";

  IF asset_kind IS DISTINCT FROM 'profile_photo' THEN
    RAISE EXCEPTION 'profile photos must use a profile_photo asset';
  END IF;

  IF asset_owner IS DISTINCT FROM NEW."user_id" THEN
    RAISE EXCEPTION 'profile photos must belong to the same user';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "profile_photo_kind_trg"
  BEFORE INSERT OR UPDATE OF "photo_asset_id" ON "user_profiles"
  FOR EACH ROW EXECUTE FUNCTION "profile_photo_kind"();
