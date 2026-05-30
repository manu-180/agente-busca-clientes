const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)="?(.*)"?$/);
  if (match) {
    let key = match[1];
    let val = match[2];
    if (val.endsWith('"')) val = val.slice(0, -1);
    process.env[key] = val;
  }
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const projectId = 'c2e63cda-ab8e-424e-9858-895f855609b7';

  const newInfos = [
    {
      project_id: projectId,
      categoria: 'servicios',
      titulo: 'Notificaciones automáticas',
      contenido: 'Cada movimiento o cambio que ocurre en la app (cancelaciones, reservas, etc.) le llega notificado al profesor automáticamente por WhatsApp, manteniéndolo al tanto de todo sin tener que gestionar él mismo.',
      activo: true
    },
    {
      project_id: projectId,
      categoria: 'servicios',
      titulo: 'Gestión manual de créditos',
      contenido: 'El profesor tiene control total sobre los créditos: puede dar, asignar o remover créditos a cualquier alumno manualmente desde la app, para que luego ellos puedan inscribirse en las clases.',
      activo: true
    }
  ];

  for (const info of newInfos) {
    const { data, error } = await supabase.from('project_info').insert([info]);
    if (error) {
      console.error('Error inserting:', info.titulo, error);
    } else {
      console.log('Inserted:', info.titulo);
    }
  }
}

run();
