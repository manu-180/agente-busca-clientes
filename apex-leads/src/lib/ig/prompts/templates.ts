interface LeadProfile {
  ig_username?: string
  full_name?: string | null
  biography?: string | null
  business_category?: string | null
}

// ── Spintax helper ────────────────────────────────────────────────────────────
// {opcion1|opcion2|opcion3} → elige una al azar

function spin(text: string): string {
  return text.replace(/\{([^}]+)\}/g, (_, group: string) => {
    const options = group.split('|')
    return options[Math.floor(Math.random() * options.length)]
  })
}

// ── Opening DM templates (5 variations) ─────────────────────────────────────

const OPENING_TEMPLATES = [
  (_lead: LeadProfile) =>
    spin(
      `{Hola|Buenas|Hola!} Vi tu {perfil|cuenta} y me {encantó|copó} lo que hacés con la boutique. Trabajo en una agencia web y te puedo armar un boceto {gratuito|gratis} de cómo quedaría tu {sitio|página}, sin compromiso. {¿Te interesa verlo?|¿Qué decís?} Si no es para vos, avisame y no te escribo más!`,
    ),

  (_lead: LeadProfile) =>
    spin(
      `{Hola|Buenas}! Me llamó la atención tu boutique en Instagram. Te ofrezco hacer un boceto {gratuito|sin costo} de tu {página web|sitio web} para que {veas cómo quedaría|te imagines cómo lucería} antes de decidir nada. {¿Le das una mirada?|¿Te copa la idea?} Si no, sin problema!`,
    ),

  (_lead: LeadProfile) =>
    spin(
      `{Hola|Buenas}! {Pasé por|Vi} tu perfil y quería preguntarte: ¿{tenés sitio web|tiene página web} tu {tienda|boutique}? En nuestra agencia hacemos bocetos {gratis|gratuitos} para {tiendas de ropa|boutiques}, para que veas cómo quedaría antes de comprometerte con nada. {¿Te interesa?|¿Qué decís?}`,
    ),

  (_lead: LeadProfile) =>
    spin(
      `{Hola|Buenas}! Soy de una agencia que trabaja con {tiendas de ropa|boutiques} y me gustaría {regalarte|ofrecerte} un boceto {gratuito|gratis} de tu posible {página web|sitio}. {Cero compromiso|Sin ningún compromiso}. {¿Le echás un vistazo?|¿Querés verlo?} Si no te copa, me avisás!`,
    ),

  (_lead: LeadProfile) =>
    spin(
      `{Hola|Hey|Buenas}! Vi lo que hacés y creo que tu boutique {merece|estaría buenísima con} su propia web. Te {armo|hago} un boceto {gratis|gratuito} para que veas cómo quedaría, sin costo ni compromiso. {¿Le damos?|¿Qué te parece?} Si no es el momento, no hay drama!`,
    ),
]

// ── Follow-up templates (2 variations) ───────────────────────────────────────

const FOLLOWUP_TEMPLATES = [
  () =>
    spin(
      `{Hola de nuevo|Buenas otra vez}! {Te escribí|Te mandé un mensaje} hace {unos días|un tiempo} sobre el boceto {gratuito|gratis} para tu {web|página}. ¿{Tuviste un momento para verlo|Pudiste leerlo}? Si no te interesa, avisame y no molesto más!`,
    ),

  () =>
    spin(
      `{Buenas|Hola}! Solo quería {retomar|seguir con} el mensaje anterior sobre el boceto web {gratuito|gratis} para tu boutique. {Si te parece|Si querés}, coordinamos {10 minutos|un ratito} para {mostrártelo|que lo veas}. {Si no es para vos|Si no es el momento}, no hay problema!`,
    ),
]

// ── Specific reply templates ──────────────────────────────────────────────────

export const REPLY_TEMPLATES = {
  // They ask what's included in the boceto
  what_includes: spin(
    `El boceto incluye: diseño de la {home|página principal}, sección de {productos|catálogo}, datos de contacto y un estilo {visual|de diseño} armado a medida del perfil de tu boutique. {Todo adaptado a vos|Pensado para tu marca}.`,
  ),

  // They ask about price
  price_question: spin(
    `El boceto es {100% gratis|completamente gratuito}, sin costo. El precio de implementación lo vemos en una {llamada de 10 minutos|charla rápida} según lo que necesites, {sin ningún compromiso|sin presión}.`,
  ),

  // They say yes / show interest
  interested_next_step: spin(
    `{Genial|Buenísimo|Perfecto}! ¿Tenés {alguna web o página actualmente|sitio web en este momento}? Así {arranco el boceto|lo armo} con el estilo que ya tenés o directamente desde cero.`,
  ),

  // Schedule a call
  schedule_call: spin(
    `{Perfecto|Genial}! ¿Qué días y horarios te quedan cómodos para una {videollamada de 10 minutos|charla rápida}? Así {te muestro el boceto|coordinamos} y {respondemos|sacamos} cualquier duda.`,
  ),

  // Polite decline close
  decline_close: spin(
    `{Perfecto, entendido|Okey, no hay drama}! Si en algún momento {cambiás de idea|te interesa}, acá {estamos|seguimos}. {Éxitos con la boutique|Mucho éxito con tu tienda}!`,
  ),

  // Ghosted close (after follow-up ignored)
  ghosted_close: spin(
    `{Okey|Bueno}, {entendido|sin problema}! Quedo a {disposición|tu disposición} si en algún momento {querés saber más|te interesa retomar}. {Éxitos|Mucho éxito} con la boutique!`,
  ),
}

export const GHOSTED_CLOSE = REPLY_TEMPLATES.ghosted_close

// ── Selectors ─────────────────────────────────────────────────────────────────

export function pickOpeningTemplate(lead: LeadProfile): string {
  const idx = Math.floor(Math.random() * OPENING_TEMPLATES.length)
  return OPENING_TEMPLATES[idx](lead)
}

export function pickFollowupTemplate(): string {
  const idx = Math.floor(Math.random() * FOLLOWUP_TEMPLATES.length)
  return FOLLOWUP_TEMPLATES[idx]()
}
