import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL_LIGA
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY_LIGA
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY_LIGA

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('❌ Faltan variables SUPABASE_URL_LIGA o SUPABASE_SERVICE_ROLE_KEY_LIGA en el .env')
}

// Cliente con permisos de administrador (Service Role)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})



// Cliente anónimo (opcional, por si se requiere interactuar como usuario público/anon)
// Si no hay anon key definida, se puede omitir o usar una key pública si existiera.
// El usuario dijo "opcional", así que lo dejaré preparado si la variable existe, sino null.
export const supabaseAnon = supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null
