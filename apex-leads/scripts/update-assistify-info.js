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

const PROJECT_ID = 'c2e63cda-ab8e-424e-9858-895f855609b7';

// ─────────────────────────────────────────────────────────────────────────────
// Plantilla del primer mensaje (enviado por el cron, interpola {{nombre}}, {{zona}})
// ─────────────────────────────────────────────────────────────────────────────
const PLANTILLA_PRIMER_MENSAJE = `Hola {{nombre}} de {{zona}}.

Desarrollamos *Assistify*, una app completamente gratis para talleres como el tuyo. Sirve para que tus alumnos cancelen y recuperen clases solos, sin preguntarle a nadie. Cada movimiento te llega notificado por WhatsApp.

Vos definís el plazo de anticipación para cancelar con crédito — por ejemplo, 24 horas. Si alguien cancela fuera de ese plazo, no gana el crédito para recuperar. También podés asignar o quitarle créditos a cualquier alumno manualmente, e inscribirlos o removerlos de las clases que armés.

¿Le das una vuelta?`;

// ─────────────────────────────────────────────────────────────────────────────
// Descripción del proyecto (aparece en la identidad del agente)
// ─────────────────────────────────────────────────────────────────────────────
const DESCRIPCION_PROYECTO = 'una app gratuita para talleres de danza, yoga, pilates y cualquier disciplina con clases fijas. Permite que los alumnos gestionen sus cancelaciones y recuperaciones solos, mientras el profesor mantiene control total y recibe notificaciones por WhatsApp.';

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge base del agente (project_info)
// ─────────────────────────────────────────────────────────────────────────────
const PROJECT_INFO = [
  {
    categoria: 'descripcion',
    titulo: 'Qué es Assistify',
    contenido: 'Assistify es una app completamente gratuita para talleres de danza, yoga, pilates, gimnasia y cualquier disciplina que maneje clases fijas con alumnos que pagan por el mes. Elimina la gestión manual de cancelaciones y la reubicación de alumnos: los propios alumnos se manejan solos, y el profesor queda libre de esa tarea.',
    activo: true,
  },
  {
    categoria: 'precio',
    titulo: 'Costo de Assistify',
    contenido: 'Assistify es completamente gratuita. No tiene costo de instalación, suscripción mensual ni límite de alumnos. El objetivo es ayudar a los talleres a funcionar mejor sin ninguna barrera económica.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Gestión de clases y horarios',
    contenido: 'El profesor crea sus clases desde la app: define el nombre, el día, el horario y la cantidad máxima de alumnos que entran. Cuando una clase se llena, el botón de inscripción se deshabilita automáticamente para que ningún alumno pueda anotarse cuando ya no hay lugar.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Sistema de créditos para cancelar y recuperar',
    contenido: 'Los alumnos necesitan créditos para inscribirse en clases disponibles cuando quieren recuperar una ausencia. Cuando un alumno cancela dentro del plazo definido por el profesor, gana automáticamente un crédito. Con ese crédito puede inscribirse en cualquier clase futura que tenga lugar libre.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Plazo de anticipación para cancelar con crédito',
    contenido: 'El profesor define cuántas horas de anticipación necesita un alumno para cancelar y ganar el crédito. Por ejemplo, si el plazo es 24 horas y un alumno cancela el mismo día de la clase, no genera crédito y no puede recuperar esa clase. Si cancela con más anticipación, sí gana el crédito.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Notificaciones automáticas al profesor por WhatsApp',
    contenido: 'Cada movimiento que ocurre en la app — cancelaciones, inscripciones, recuperaciones — le llega notificado automáticamente al profesor por WhatsApp. No necesita revisar la app ni preguntar nada: toda la actividad de sus alumnos le llega directo al celular.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Control manual de créditos por el profesor',
    contenido: 'El profesor tiene control total sobre los créditos: puede dar o quitar créditos a cualquier alumno de forma manual desde la app. Esto sirve para casos especiales, excepciones o ajustes puntuales que el sistema automático no cubre.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'El profesor puede inscribir o remover alumnos de las clases',
    contenido: 'Además de lo que hacen los alumnos por su cuenta, el profesor puede inscribir manualmente a cualquier alumno en una clase o removerlo cuando lo necesite. Tiene control total sobre la composición de cada clase.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Auto-gestión del alumno',
    contenido: 'Los alumnos pueden cancelar sus clases y recuperarlas en cualquier horario disponible sin necesidad de escribirle al profesor. Solo ven las clases con lugar disponible para inscribirse. El proceso es simple: cancelar → ganar crédito → inscribirse en una clase libre.',
    activo: true,
  },
  {
    categoria: 'beneficios',
    titulo: 'Beneficio principal: elimina el trabajo de reubicar alumnos',
    contenido: 'Como los alumnos tienen sus clases pagas, siempre hay un flujo de cancelaciones y pedidos de recuperación. Antes el profesor tenía que gestionar eso manualmente. Con Assistify, los alumnos mismos se reasignan a clases con lugar disponible, y el profesor no tiene que intervenir.',
    activo: true,
  },
  {
    categoria: 'objeciones',
    titulo: 'El alumno ya pagó y quiere recuperar la clase',
    contenido: 'Exactamente para eso está Assistify. El alumno cancela su clase dentro del plazo, gana el crédito y puede inscribirse solo en cualquier clase que tenga lugar disponible, cuando quiera y sin molestar al profesor.',
    activo: true,
  },
  {
    categoria: 'objeciones',
    titulo: 'Qué pasa cuando la clase está llena',
    contenido: 'Cuando una clase alcanzó su capacidad máxima, el botón de inscripción se deshabilita automáticamente. El alumno ve que no hay lugar disponible y puede elegir otra clase con espacio libre. El profesor definió esa capacidad al crear la clase.',
    activo: true,
  },
  {
    categoria: 'objeciones',
    titulo: 'Cómo sabe el profesor lo que pasa si no está mirando la app',
    contenido: 'No necesita estar pendiente de la app. Cada cancelación, inscripción o cambio genera una notificación automática que le llega por WhatsApp. Si un alumno cancela a las 8pm, el profesor lo sabe al instante en el celular.',
    activo: true,
  },
];

async function run() {
  console.log('── Actualizando proyecto Assistify ──\n');

  // 1. Actualizar plantilla y descripción del proyecto
  const { error: projErr } = await supabase
    .from('projects')
    .update({
      plantilla_primer_mensaje: PLANTILLA_PRIMER_MENSAJE,
      descripcion: DESCRIPCION_PROYECTO,
    })
    .eq('id', PROJECT_ID);

  if (projErr) {
    console.error('Error actualizando proyecto:', projErr);
    return;
  }
  console.log('✓ plantilla_primer_mensaje y descripcion actualizadas en projects\n');

  // 2. Borrar project_info existente (evitar duplicados)
  const { error: delErr } = await supabase
    .from('project_info')
    .delete()
    .eq('project_id', PROJECT_ID);

  if (delErr) {
    console.error('Error borrando project_info existente:', delErr);
    return;
  }
  console.log('✓ project_info anterior eliminada\n');

  // 3. Insertar nueva knowledge base
  for (const info of PROJECT_INFO) {
    const { error } = await supabase
      .from('project_info')
      .insert([{ ...info, project_id: PROJECT_ID }]);

    if (error) {
      console.error('Error insertando:', info.titulo, error);
    } else {
      console.log(`✓ ${info.titulo}`);
    }
  }

  console.log('\n── Listo. ──');
}

run();
