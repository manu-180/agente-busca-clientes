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
  const { data: projects, error } = await supabase.from('projects').select('*').eq('slug', 'assistify');
  if (error) {
    console.error('Error fetching project:', error);
    return;
  }
  console.log('Project:', projects);

  if (projects.length > 0) {
    const { data: info, error: infoError } = await supabase.from('project_info').select('*').eq('project_id', projects[0].id);
    if (infoError) {
      console.error('Error fetching project_info:', infoError);
    } else {
      console.log('Project Info:', info);
    }
  }
}

run();
