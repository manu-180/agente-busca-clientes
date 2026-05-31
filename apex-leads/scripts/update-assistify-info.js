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

// ===========================================================================
// Plantilla del primer mensaje
// Enviada por el cron. Interpola {{nombre}}, {{zona}}, {{rubro}}.
// Gancho: abre con el dolor concreto (bombardeo de WhatsApps), luego solución
// + lista de espera automática (feature diferenciadora) + link + CTA suave.
// ===========================================================================
const PLANTILLA_PRIMER_MENSAJE = `Hola {{nombre}} de {{zona}}.

¿Cuántos mensajes por semana recibís de alumnos que quieren cancelar, preguntar si hay lugar o recuperar una clase?

Desarrollamos *Assistify* gratis para que eso deje de pasar. El alumno cancela solo desde la app, recupera su crédito si lo hace a tiempo y se anota en otro horario disponible. Vos recibís cada movimiento por WhatsApp y no tenés que intervenir.

Si la clase está llena hay lista de espera automática: cuando alguien cancela, el siguiente de la lista entra solo y recibe aviso. Sin que vos hagas nada.

Descargála acá: https://leads.theapexweb.com/d/assistify

¿Lo ves útil para tu taller?`;

// ===========================================================================
// Descripcion del proyecto (identidad del agente en el system prompt)
// ===========================================================================
const DESCRIPCION_PROYECTO = 'una app gratuita para talleres de danza, yoga, pilates, ceramica y cualquier disciplina con clases fijas. Permite que los alumnos gestionen sus cancelaciones y recuperaciones solos, mientras el profesor mantiene control total y recibe notificaciones por WhatsApp.';

// ===========================================================================
// Knowledge base del agente (project_info)
// El agente usa estos datos para responder sin inventar nada.
// ===========================================================================
const PROJECT_INFO = [
  // Descripcion general
  {
    categoria: 'descripcion',
    titulo: 'Que es Assistify',
    contenido: 'Assistify es una app completamente gratuita para talleres y estudios: ceramica, yoga, danza, pilates, idiomas, fitness y cualquier disciplina con clases fijas. Disponible en Android, iOS, web y Windows. Elimina el caos de gestionar cancelaciones y recuperaciones por WhatsApp: los alumnos se manejan solos, y el profesor recibe todo notificado sin intervenir.',
    activo: true,
  },
  {
    categoria: 'precio',
    titulo: 'Costo de Assistify',
    contenido: 'Assistify es completamente gratuita. No tiene costo de instalacion, suscripcion mensual ni limite de alumnos. No hay planes pagos activos. Todos los talleres usan la app sin ningun costo.',
    activo: true,
  },

  // Funcionalidades core
  {
    categoria: 'funcionalidades',
    titulo: 'Gestion de clases y horarios',
    contenido: 'El profesor crea sus clases con nombre, dia, horario y capacidad maxima de alumnos. La app genera la grilla del mes automaticamente a partir de esos horarios. Cuando una clase se llena, el boton de inscripcion se deshabilita solo, sin que el profesor haga nada.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Sistema de creditos',
    contenido: 'Cada alumno tiene creditos (en la app aparece como "clases disponibles"). Inscribirse a una clase consume 1 credito. Cancelar dentro del plazo de anticipacion devuelve 1 credito. El profesor puede dar o quitar creditos manualmente desde Gestion de usuarios.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Plazo de anticipacion para cancelar con credito',
    contenido: 'El profesor configura cuantas horas de anticipacion necesita un alumno para cancelar y recuperar el credito (en Configuracion -> Cancelaciones). Si cancela dentro de ese plazo, no se devuelve el credito. El alumno ve claramente antes de confirmar si va a ganar el credito o no.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Lista de espera automatica',
    contenido: 'Cuando una clase esta llena, el alumno puede anotarse en lista de espera sin consumir credito. Si alguien cancela, el sistema promueve al primero de la lista que tenga credito disponible: le descuenta el credito, lo agrega a la clase y le manda un WhatsApp avisando que ya esta confirmado. El profesor no tiene que hacer nada.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Notificaciones automaticas al profesor por WhatsApp',
    contenido: 'Cada movimiento en la app le llega al profesor por WhatsApp: cuando un alumno se inscribe, cancela, o es promovido desde la lista de espera. No necesita abrir la app para saber que paso con sus clases.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Control manual del profesor sobre alumnos y creditos',
    contenido: 'El profesor puede inscribir o remover a cualquier alumno de una clase, y dar o quitar creditos manualmente. Sirve para excepciones, alumnos que avisaron por otro canal, o ajustes puntuales.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Grupo familiar (padre que paga por hijos)',
    contenido: 'Un padre puede crear una cuenta y agregar familiares dependientes (hijos) desde Configuracion -> Familia. Cada hijo tiene su propio perfil e historial, pero los creditos se descuentan del saldo del padre. Si un hijo cancela a tiempo, el credito vuelve al padre.',
    activo: true,
  },
  {
    categoria: 'funcionalidades',
    titulo: 'Asistente de voz',
    contenido: 'Los alumnos pueden usar un boton flotante para hablar con la app: "cancelame la clase del martes", "inscribime el jueves a las 18", "que clases tengo esta semana". La app interpreta el comando y ejecuta la accion.',
    activo: true,
  },

  // Beneficios
  {
    categoria: 'beneficios',
    titulo: 'Beneficio principal: cero interrupciones para el profesor',
    contenido: 'El dolor real que resuelve Assistify es el bombardeo de WhatsApps: alumnos que cancelan por mensaje, preguntan si hay lugar, piden recuperar. Con Assistify todo eso desaparece: el alumno lo hace solo en la app y el profesor solo recibe el aviso.',
    activo: true,
  },
  {
    categoria: 'beneficios',
    titulo: 'Lista de espera = cero cupos perdidos',
    contenido: 'Antes, cuando alguien cancelaba, el cupo quedaba libre y nadie se enteraba a tiempo. Ahora el primero de la lista de espera entra automaticamente en segundos. El taller nunca pierde capacidad por falta de comunicacion.',
    activo: true,
  },

  // Objeciones y casos borde
  {
    categoria: 'objeciones',
    titulo: 'Cancelo a tiempo pero no ve el credito',
    contenido: 'Si el alumno es parte de un grupo familiar, el credito aparece en la cuenta del padre/titular, no en la del hijo. Hay que revisar los creditos del titular del grupo.',
    activo: true,
  },
  {
    categoria: 'objeciones',
    titulo: 'Cancelo tarde y reclama el credito',
    contenido: 'La politica la define el taller. Fuera del plazo de anticipacion no se devuelve el credito. Si el alumno quiere una excepcion, tiene que pedírsela al profesor directamente.',
    activo: true,
  },
  {
    categoria: 'objeciones',
    titulo: 'Todas las clases estan llenas',
    contenido: 'El alumno puede anotarse en lista de espera de cualquier clase. No consume credito hasta que sea promovido. No hay limite de personas en lista de espera.',
    activo: true,
  },
  {
    categoria: 'objeciones',
    titulo: 'Esta en espera y nunca le llego el aviso de que entro',
    contenido: 'Para ser promovido automaticamente desde la lista de espera, el alumno necesita tener al menos 1 credito disponible en el momento en que se libera el cupo. Si no tiene credito, el sistema pasa al siguiente de la lista.',
    activo: true,
  },
  {
    categoria: 'objeciones',
    titulo: 'No puede inscribirse aunque tiene credito',
    contenido: 'Las razones mas comunes son: la clase esta llena (puede anotarse en espera), la clase ya paso (la UI filtra las pasadas), es un feriado marcado por el taller, o es una cuenta de hijo con el saldo del padre en 0.',
    activo: true,
  },
  {
    categoria: 'objeciones',
    titulo: 'Quiere recuperar una clase del mes pasado',
    contenido: 'No es posible. Los meses cerrados estan archivados. Solo se puede inscribir en clases del mes activo.',
    activo: true,
  },
  {
    categoria: 'objeciones',
    titulo: 'Como se une un alumno al taller',
    contenido: 'El alumno descarga la app, en el onboarding ingresa el codigo de invitacion que le da el profesor (un codigo unico por taller), crea su cuenta y queda vinculado automaticamente. El profesor le carga los creditos iniciales desde Gestion de usuarios.',
    activo: true,
  },
];

async function run() {
  console.log('-- Actualizando proyecto Assistify --\n');

  // 1. Actualizar plantilla y descripcion del proyecto
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
  console.log('ok plantilla_primer_mensaje y descripcion actualizadas en projects\n');

  // 2. Borrar project_info existente (evitar duplicados)
  const { error: delErr } = await supabase
    .from('project_info')
    .delete()
    .eq('project_id', PROJECT_ID);

  if (delErr) {
    console.error('Error borrando project_info existente:', delErr);
    return;
  }
  console.log('ok project_info anterior eliminada\n');

  // 3. Insertar nueva knowledge base
  for (const info of PROJECT_INFO) {
    const { error } = await supabase
      .from('project_info')
      .insert([{ ...info, project_id: PROJECT_ID }]);

    if (error) {
      console.error('Error insertando:', info.titulo, error);
    } else {
      console.log(`ok ${info.titulo}`);
    }
  }

  console.log('\n-- Listo. --');
}

run();
