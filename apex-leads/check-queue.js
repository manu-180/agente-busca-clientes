const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hpbxscfbnhspeckdmkvu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwYnhzY2ZibmhzcGVja2Rta3Z1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjI2ODI0NSwiZXhwIjoyMDkxODQ0MjQ1fQ.lGed-lWWcjScwu_j60hOp5VQWEK87xeNgLAaKun0Dt4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDescartados() {
  const { data, error } = await supabase
    .from('leads')
    .select('primer_envio_error, project_id, created_at')
    .eq('estado', 'descartado');

  if (error) {
    console.error('Error fetching leads:', error);
    return;
  }
  
  const reasons = data.reduce((acc, l) => {
    const errorMsg = l.primer_envio_error || 'null';
    acc[errorMsg] = (acc[errorMsg] || 0) + 1;
    return acc;
  }, {});
  
  console.log('Razones de descarte:', reasons);
}

checkDescartados();
