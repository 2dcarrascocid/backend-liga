-- ============================================================
-- Migration: lg_player_documents
-- Descripción: Tabla para almacenar documentación adjunta
--              a jugadores (contratos, fichas médicas, carnet, etc.)
-- Fecha: 2026-03-25
-- ============================================================

CREATE TABLE IF NOT EXISTS lg_player_documents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       uuid        NOT NULL REFERENCES lg_players(id) ON DELETE CASCADE,
  uploaded_by     uuid        NOT NULL,                     -- auth.users.id del que subió
  nombre_original text        NOT NULL,                     -- nombre original del archivo
  mime_type       text        NOT NULL,                     -- application/pdf, image/jpeg, etc.
  size            bigint      NOT NULL,                     -- tamaño en bytes
  bucket          text        NOT NULL DEFAULT 'player-documents',  -- bucket en Supabase Storage
  path            text        NOT NULL,                     -- path dentro del bucket (único)
  url_publica     text,                                     -- URL pública si el bucket es público, null si privado
  hash            text,                                     -- hash SHA-256 para integridad/dedup (opcional)
  estado          text        NOT NULL DEFAULT 'ACTIVE'
                              CHECK (estado IN ('ACTIVE', 'DELETED')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_player_documents_player_id
  ON lg_player_documents(player_id);

CREATE INDEX IF NOT EXISTS idx_player_documents_estado
  ON lg_player_documents(estado);

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_documents_path
  ON lg_player_documents(path);

-- ============================================================
-- RLS
-- Todos los accesos van por el backend con service_role,
-- que bypasea RLS por defecto en Supabase.
-- Se habilita RLS de todas formas para proteger accesos directos,
-- con políticas explícitas para cada operación del backend.
-- ============================================================

ALTER TABLE lg_player_documents ENABLE ROW LEVEL SECURITY;

-- SELECT: usuarios autenticados ven documentos ACTIVE
CREATE POLICY "player_documents_select"
  ON lg_player_documents
  FOR SELECT
  TO authenticated
  USING (estado = 'ACTIVE');

-- INSERT: usuarios autenticados pueden insertar (service_role bypasea esto igualmente)
CREATE POLICY "player_documents_insert"
  ON lg_player_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE: usuarios autenticados pueden actualizar (soft-delete)
CREATE POLICY "player_documents_update"
  ON lg_player_documents
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Storage bucket (ejecutar en Supabase Dashboard o via API)
-- ============================================================
-- Crear bucket privado 'player-documents' si no existe:
--
--   INSERT INTO storage.buckets (id, name, public)
--   VALUES ('player-documents', 'player-documents', false)
--   ON CONFLICT (id) DO NOTHING;
--
-- O desde el Dashboard: Storage → New bucket → nombre: player-documents → privado
-- ============================================================
