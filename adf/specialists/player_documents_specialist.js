/**
 * ADF - Player Documents Specialist (Specialists Layer)
 *
 * Gestiona los metadatos de documentación adjunta a jugadores.
 * Los archivos se almacenan en Cloudinary (subida directa desde el frontend).
 * Este specialist solo opera sobre la tabla lg_player_documents en Supabase.
 *
 * DO:
 *   - Operar sobre lg_player_documents
 *   - Solo retornar documentos con estado = 'ACTIVE' en listados
 *   - Soft-delete: cambiar estado a 'DELETED', nunca borrar la fila
 *   - Retornar url_publica directamente (Cloudinary ya la sirve, no se necesita firmar)
 *
 * DON'T:
 *   - No subir archivos — el cliente sube directo a Cloudinary
 *   - No borrar archivos de Cloudinary desde aquí
 *   - No usar Supabase Storage
 *
 * Capabilities:
 *   LIST_DOCUMENTS | REGISTER_DOCUMENT | GET_DOCUMENT | DELETE_DOCUMENT
 *
 * Checklist:
 *   [x] ¿LIST_DOCUMENTS filtra solo estado='ACTIVE'?
 *   [x] ¿REGISTER_DOCUMENT valida campos obligatorios?
 *   [x] ¿DELETE_DOCUMENT hace soft-delete?
 *   [x] ¿url_publica se retorna tal cual (Cloudinary CDN)?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

const CAPABILITIES = [
  'LIST_DOCUMENTS',
  'REGISTER_DOCUMENT',
  'GET_DOCUMENT',
  'DELETE_DOCUMENT',
];

export class PlayerDocumentsSpecialist extends Skill {
  constructor() {
    super('player_documents_specialist', '1.1.0');
    this.domain = 'player_documents';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation',  required: true,  type: 'string' },
        { name: 'payload',    required: true,  type: 'object' },
        { name: 'db',         required: true,  type: 'object' },
        { name: 'userId',     required: false, type: 'string' },
      ],
      output: [
        { name: 'document',  type: 'object' },
        { name: 'documents', type: 'array'  },
      ],
      rules: {
        do: [
          'Filtrar estado=ACTIVE en listados',
          'Soft-delete en DELETE_DOCUMENT',
          'Retornar url_publica de Cloudinary directamente',
        ],
        dont: [
          'No subir archivos (cliente sube a Cloudinary directamente)',
          'No usar Supabase Storage',
        ],
      },
    };
  }

  async execute(task) {
    const { operation, payload, db, userId } = task.input;

    if (!this.capabilities.includes(operation)) {
      return createSkillResult({
        success: false,
        errorCode: 'UNKNOWN_OPERATION',
        errorMessage: `Operación desconocida: "${operation}"`,
      });
    }

    try {
      switch (operation) {
        case 'LIST_DOCUMENTS':    return this._listDocuments(payload, db);
        case 'REGISTER_DOCUMENT': return this._registerDocument(payload, db, userId);
        case 'GET_DOCUMENT':      return this._getDocument(payload, db);
        case 'DELETE_DOCUMENT':   return this._deleteDocument(payload, db);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'PLAYER_DOCUMENTS_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  // ── Operations ───────────────────────────────────────────────────────────

  async _listDocuments({ playerId }, db) {
    const { data: documents, error } = await db
      .from('lg_player_documents')
      .select('*')
      .eq('player_id', playerId)
      .eq('estado', 'ACTIVE')
      .order('created_at', { ascending: false });

    if (error) {
      return createSkillResult({ success: false, errorCode: 'LIST_DOCUMENTS_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { documents: documents ?? [] } });
  }

  async _registerDocument({ playerId, nombreOriginal, mimeType, size, path, bucket, urlPublica }, db, userId) {
    if (!playerId || !nombreOriginal || !mimeType || !size || !path) {
      return createSkillResult({
        success: false,
        errorCode: 'VALIDATION_FAILED',
        errorMessage: 'Se requiere playerId, nombreOriginal, mimeType, size y path',
      });
    }

    const { data: doc, error } = await db
      .from('lg_player_documents')
      .insert({
        player_id:       playerId,
        uploaded_by:     userId,
        nombre_original: nombreOriginal,
        mime_type:       mimeType,
        size:            parseInt(size, 10),
        bucket:          bucket || 'cloudinary',
        path,
        url_publica:     urlPublica || null,
        estado:          'ACTIVE',
      })
      .select()
      .single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'REGISTER_DOCUMENT_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { document: doc } });
  }

  async _getDocument({ documentId, playerId }, db) {
    let query = db
      .from('lg_player_documents')
      .select('*')
      .eq('id', documentId)
      .eq('estado', 'ACTIVE');

    if (playerId) query = query.eq('player_id', playerId);

    const { data: doc, error } = await query.single();

    if (error || !doc) {
      return createSkillResult({ success: false, errorCode: 'DOCUMENT_NOT_FOUND', errorMessage: 'Documento no encontrado' });
    }

    return createSkillResult({ success: true, data: { document: doc } });
  }

  async _deleteDocument({ documentId, playerId }, db) {
    let query = db
      .from('lg_player_documents')
      .update({ estado: 'DELETED' })
      .eq('id', documentId)
      .eq('estado', 'ACTIVE');

    if (playerId) query = query.eq('player_id', playerId);

    const { data: doc, error } = await query.select().single();

    if (error || !doc) {
      return createSkillResult({ success: false, errorCode: 'DELETE_DOCUMENT_FAILED', errorMessage: 'Documento no encontrado o ya eliminado' });
    }

    return createSkillResult({ success: true, data: { document: doc } });
  }
}
