export const LEADS_TABLES = ['leads', 'leads_apex_next'] as const

export async function ejecutarConTablaLeads<T>(
  callback: (
    tabla: (typeof LEADS_TABLES)[number]
  ) => PromiseLike<{ data: T | null; error: { message: string } | null }>
) {
  for (const tabla of LEADS_TABLES) {
    const resultado = await callback(tabla)

    if (!resultado.error) return resultado

    const tablaNoExiste =
      resultado.error.message.includes("Could not find the table 'public.leads'") ||
      resultado.error.message.includes("Could not find the table 'public.leads_apex_next'")

    if (!tablaNoExiste) return resultado
  }

  return { data: null, error: { message: 'No existe la tabla de leads esperada en Supabase.' } }
}
