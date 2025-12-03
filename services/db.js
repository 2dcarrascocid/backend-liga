import { createClient } from '@supabase/supabase-js'

const supabaseUrlLiga = process.env.SUPABASE_URL_LIGA
const supabaseServiceKeyLiga = process.env.SUPABASE_SERVICE_ROLE_KEY_LIGA

if (!supabaseUrlLiga || !supabaseServiceKeyLiga) {
  throw new Error('❌ Faltan variables SUPABASE_URL_LIGA o SUPABASE_SERVICE_ROLE_KEY_LIGA en el .env')
}

// Exportamos como 'supabase' para mantener compatibilidad con el resto del código
// pero usamos las credenciales de LIGA.
export const supabase = createClient(supabaseUrlLiga, supabaseServiceKeyLiga)
export const supraLiga = supabase; // Alias por si acaso