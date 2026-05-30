const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hpbxscfbnhspeckdmkvu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwYnhzY2ZibmhzcGVja2Rta3Z1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjI2ODI0NSwiZXhwIjoyMDkxODQ0MjQ1fQ.lGed-lWWcjScwu_j60hOp5VQWEK87xeNgLAaKun0Dt4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkQuota() {
  const month = '2026-05';
  const { data, error } = await supabase
    .from('places_api_key_usage')
    .select('*')
    .eq('month_yyyymm', month);

  if (error) {
    console.error('Error fetching usage:', error);
    return;
  }
  
  console.log('Usage for month', month, ':', data);
}

checkQuota();
