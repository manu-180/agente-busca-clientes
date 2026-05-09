/**
 * Localidades principales de Argentina — modo eficiencia.
 *
 * Criterio de inclusión (≈ INDEC):
 *   - Capital provincial.
 *   - Cabeceras de partido (Buenos Aires) o departamento (resto).
 *   - Localidades con ≥ 10.000 habitantes (aglomerados urbanos INDEC).
 *   - Centros turísticos / comerciales con tráfico significativo aunque < 10k hab.
 *
 * Por qué existe:
 *   - Cada Text Search a Google Places gasta 1 request del cupo gratis,
 *     da igual que la zona sea Palermo o un paraje de 200 hab.
 *   - El catálogo Georef tiene 3.873 localidades; gran parte son parajes
 *     rurales sin actividad comercial relevante. Buscarlas es ruido puro.
 *   - Activando "modo eficiencia", la corrida usa sólo ~10-15% de las
 *     localidades pero captura > 90% del comercio real.
 *
 * Si una entrada acá no coincide exactamente con un nombre del catálogo
 * (`locations-ar.ts`), simplemente no matchea y se ignora — no rompe nada.
 * Para validar qué entradas quedaron huérfanas, correr
 * `node scripts/validate-localidades-principales.mjs` desde `apex-leads/`.
 */
import type { Localidad, Provincia, Pais } from './locations-ar'

/**
 * Sentinela: una provincia mapeada al string `'*'` en lugar de un array
 * significa "todas sus localidades son principales". Se usa para CABA
 * y otros casos donde casi todo es comercial.
 */
type ListaPrincipales = readonly string[] | '*'

const RAW: Record<string, ListaPrincipales> = {
  // =========================================================================
  // CABA — los 49 barrios son zonas comerciales densas. No filtramos.
  // =========================================================================
  'Ciudad Autónoma de Buenos Aires': '*',

  // =========================================================================
  // BUENOS AIRES — capital + GBA + interior con > 10k hab.
  // =========================================================================
  'Buenos Aires': [
    // Capital y conurbano La Plata
    'La Plata', 'Berisso', 'Ensenada', 'City Bell', 'Manuel B. Gonnet',
    'Joaquín Gorina', 'Villa Elisa', 'Tolosa', 'Los Hornos', 'Ringuelet',
    'Abasto', 'Arturo Seguí', 'Lisandro Olmos',

    // GBA Sur
    'Avellaneda', 'Gerli', 'Sarandí', 'Wilde', 'Dock Sud', 'Villa Domínico',
    'Lanús Este', 'Lanús Oeste', 'Valentín Alsina', 'Remedios de Escalada',
    'Lomas de Zamora', 'Banfield', 'Temperley', 'Turdera',
    'Almirante Brown', 'Adrogué', 'Burzaco', 'Longchamps', 'Glew',
    'Claypole', 'Rafael Calzada', 'José Mármol',
    'Quilmes', 'Bernal', 'Don Bosco', 'Ezpeleta',
    'Berazategui', 'Guillermo Enrique Hudson', 'Plátanos', 'Ranelagh',
    'Florencio Varela', 'Bosques',
    'Esteban Echeverría', 'Monte Grande', 'Luis Guillón', 'El Jagüel',
    'Ezeiza', 'Tristán Suárez', 'La Unión', 'Canning',
    'San Vicente',

    // GBA Oeste
    'La Matanza', 'San Justo', 'Ramos Mejía', 'La Tablada', 'Tapiales',
    'Lomas del Mirador', 'Villa Eduardo Madero', 'Villa Luzuriaga', 'Aldo Bonzi',
    'Ciudad Evita', 'Isidro Casanova', 'González Catán', 'Rafael Castillo',
    'Gregorio de Laferrere', 'Virrey del Pino',
    'Morón', 'Castelar', 'El Palomar', 'Haedo',
    'Tres de Febrero', 'Caseros', 'Sáenz Peña', 'Ciudadela', 'Villa Bosch',
    'Loma Hermosa', 'José Ingenieros', 'Churruca', 'Pablo Podestá',
    'Ituzaingó', 'Gobernador Udaondo',
    'Hurlingham',
    'Merlo', 'Libertad', 'San Antonio de Padua', 'Mariano Acosta', 'Pontevedra',
    'Moreno', 'Paso del Rey', 'La Reja', 'Francisco Álvarez',
    'General Rodríguez', 'Marcos Paz',

    // GBA Norte
    'Vicente López', 'Olivos', 'Florida', 'Munro', 'Carapachay',
    'Villa Adelina', 'Villa Martelli',
    'San Isidro', 'Béccar', 'Martínez', 'Acasusso', 'Boulogne Sur Mer',
    'General San Martín', 'Villa Ballester', 'Villa José León Suárez', 'Villa Lynch',
    'Tigre', 'Don Torcuato Este', 'Don Torcuato Oeste', 'General Pacheco',
    'Benavídez', 'Rincón de Milberg', 'Troncos del Talar', 'El Talar',
    'Dique Luján',
    'San Fernando', 'Virreyes', 'Victoria',
    'Escobar', 'Belén de Escobar', 'Garín', 'Ingeniero Maschwitz',
    'Maquinista F. Savio Este', 'Maquinista F. Savio Oeste',
    'Pilar', 'Del Viso', 'Presidente Derqui', 'Villa Rosa', 'Manzanares',
    'Malvinas Argentinas', 'Los Polvorines', 'Grand Bourg', 'Tortuguitas',
    'José C. Paz',
    'San Miguel', 'Bella Vista', 'Muñiz',

    // Norte/agro
    'Zárate', 'Lima', 'Escalada',
    'San Pedro', 'San Nicolás de los Arroyos', 'Ramallo',
    'Baradero', 'Pergamino', 'Salto', 'Rojas',
    'Junín', 'Chacabuco', 'General Arenales',
    'Mercedes', 'Suipacha', 'Luján',
    'Chivilcoy', 'Bragado', 'Lincoln',
    'Trenque Lauquen', 'General Villegas', 'Pehuajó', 'Carlos Casares',
    '9 de Julio', 'Henderson', 'Daireaux',
    '25 de Mayo', 'Las Flores',
    'San Carlos de Bolívar', 'Olavarría', 'Sierra Chica', 'Hinojo',
    'Azul', 'Tapalqué', 'Rauch',
    'General Juan Madariaga', 'Pinamar', 'Villa Gesell', 'Cariló',
    'San Bernardo', 'Mar de Ajó', 'Santa Teresita', 'San Clemente del Tuyú',
    'Las Toninas', 'Mar del Tuyú',
    'General Lavalle', 'Dolores', 'General Guido', 'Maipú',
    'General Belgrano', 'Chascomús',
    'Lobos', 'Cañuelas', 'Coronel Brandsen',
    'Magdalena', 'Punta Indio',
    'Mar del Plata', 'Mar Chiquita', 'Coronel Vidal', 'Balcarce', 'Ayacucho',
    'Tandil', 'Lobería', 'Necochea', 'Quequén', 'Miramar',

    // Sudoeste / Costa Atlántica sur
    'Tres Arroyos', 'Claromecó', 'Reta', 'Orense',
    'Bahía Blanca', 'Punta Alta', 'General Daniel Cerri', 'Ingeniero White',
    'Coronel Suárez', 'Coronel Pringles', 'Coronel Dorrego',
    'Tornquist', 'Villa Ventana', 'Saavedra',
    'Pigüé', 'Carhué',
    'Monte Hermoso', 'Carmen de Patagones',
  ],

  // =========================================================================
  // CATAMARCA
  // =========================================================================
  'Catamarca': [
    'San Fernando del Valle de Catamarca', 'San Isidro',
    'Andalgalá', 'Belén', 'Tinogasta', 'Recreo', 'Santa María',
    'Fiambalá', 'Saujil', 'Pomán', 'Capayán',
    'Aconquija', 'Hualfín', 'Antofagasta de la Sierra',
    'El Rodeo', 'La Puerta', 'Villa Las Pirquitas',
  ],

  // =========================================================================
  // CHACO
  // =========================================================================
  'Chaco': [
    'Resistencia', 'Barranqueras', 'Fontana', 'Puerto Vilelas',
    'Presidencia Roque Sáenz Peña', 'Villa Angela', 'Charata',
    'General José de San Martín', 'Las Breñas', 'Quitilipi',
    'Machagai', 'Juan José Castelli',
    'Tres Isletas', 'Pampa del Indio', 'Pampa del Infierno',
    'Puerto Tirol', 'Margarita Belén', 'Colonia Elisa',
    'Presidencia de la Plaza', 'General Pinedo', 'Hermoso Campo',
    'Corzuela', 'Las Palmas', 'La Leonesa', 'Makallé',
    'Charadai', 'Colonias Unidas',
  ],

  // =========================================================================
  // CHUBUT
  // =========================================================================
  'Chubut': [
    'Rawson', 'Trelew', 'Puerto Madryn', 'Comodoro Rivadavia',
    'Esquel', 'Sarmiento', 'Gaiman', 'Dolavon', '28 de Julio',
    'Rada Tilly', 'El Maitén', 'El Hoyo',
    'Lago Puelo', 'Epuyén', 'Cholila', 'Gobernador Costa',
    'José de San Martín', 'Río Mayo', 'Alto Río Senguer',
    'Camarones', 'Puerto Pirámides', 'Las Plumas',
  ],

  // =========================================================================
  // CÓRDOBA
  // =========================================================================
  'Córdoba': [
    // Capital y conurbano
    'Córdoba', 'Villa Allende', 'Unquillo', 'Río Ceballos', 'Saldán',
    'Mendiolaza', 'La Calera', 'Malagueño', 'Alta Gracia',
    'Anisacate', 'Villa Carlos Paz', 'Tanti', 'Villa Giardino',

    // Sierras
    'La Falda', 'Capilla del Monte', 'Cosquín', 'La Cumbre',
    'Huerta Grande', 'Valle Hermoso', 'Bialet Massé', 'Villa Giardino',
    'Mina Clavero', 'Nono', 'Villa Cura Brochero',
    'Santa Rosa de Calamuchita', 'Villa General Belgrano', 'La Cumbrecita',
    'Embalse', 'Río Tercero', 'Almafuerte',
    'Despeñaderos', 'Villa del Rosario', 'Río Segundo', 'Pilar',
    'Oncativo',

    // Resto interior
    'Río Cuarto', 'Las Higueras', 'Vicuña Mackenna', 'Río Cuarto',
    'Villa María', 'Villa Nueva', 'Villa del Rosario',
    'Bell Ville', 'Marcos Juárez', 'Leones', 'Corral de Bustos',
    'San Francisco', 'Devoto', 'Brinkmann', 'Morteros',
    'Jesús María', 'Colonia Caroya', 'Villa del Totoral',
    'Cruz del Eje', 'Deán Funes', 'Villa de María', 'Villa Dolores',
    'La Carlota', 'Laboulaye', 'Huinca Renancó',
  ],

  // =========================================================================
  // CORRIENTES
  // =========================================================================
  'Corrientes': [
    'Corrientes', 'Goya', 'Mercedes', 'Curuzú Cuatiá', 'Paso de los Libres',
    'Bella Vista', 'Esquina', 'Saladas', 'Empedrado', 'Santo Tomé',
    'Ituzaingó', 'San Luis del Palmar', 'Monte Caseros', 'Sauce',
    'San Cosme', 'Itatí', 'Mburucuyá', 'Concepción', 'Riachuelo',
    'San Roque', 'Lavalle', 'Santa Lucía', 'Mocoretá',
    'Nuestra Señora del Rosario de Caá Catí', 'Loreto',
    'Gobernador Igr. Valentín Virasoro',
  ],

  // =========================================================================
  // ENTRE RÍOS
  // =========================================================================
  'Entre Ríos': [
    'Paraná', 'Concordia', 'Gualeguaychú', 'Concepción del Uruguay',
    'Gualeguay', 'Victoria', 'La Paz', 'Diamante', 'Nogoyá', 'Villaguay',
    'Chajarí', 'Federación', 'Federal', 'Crespo', 'Hasenkamp',
    'San Salvador', 'Colón', 'San José', 'Villa Elisa',
    'Basavilbaso', 'Rosario del Tala', 'Hernandarias', 'Cerrito',
    'Bovril', 'Maciá', 'Villa Urquiza', 'Seguí', 'Oro Verde',
    'María Grande', 'Viale', 'Larroque', 'Lucas González',
    'San Benito', 'San José de Feliciano', 'Pueblo General Belgrano',
  ],

  // =========================================================================
  // FORMOSA
  // =========================================================================
  'Formosa': [
    'Formosa', 'Clorinda', 'Pirané', 'Las Lomitas',
    'Ingeniero Guillermo N. Juárez',
    'El Colorado', 'Comandante Fontana', 'Estanislao del Campo',
    'Ibarreta', 'San Francisco de Laishi', 'Villa Escolar',
    'Misión Tacaaglé', 'El Espinillo', 'Buena Vista',
  ],

  // =========================================================================
  // JUJUY
  // =========================================================================
  'Jujuy': [
    'San Salvador de Jujuy', 'Palpalá', 'Yala', 'San Pedro',
    'Libertador General San Martín', 'Perico', 'Monterrico', 'El Carmen',
    'Humahuaca', 'Tilcara', 'Purmamarca', 'Maimará', 'Volcán',
    'La Quiaca', 'Abra Pampa', 'Susques', 'El Aguilar',
    'Fraile Pintado', 'Calilegua', 'Yuto', 'Caimancito',
    'La Esperanza', 'Pampa Blanca', 'San Pablo de Reyes', 'San Antonio',
  ],

  // =========================================================================
  // LA PAMPA
  // =========================================================================
  'La Pampa': [
    'Santa Rosa', 'General Pico', 'Toay', 'General Acha', 'Realicó',
    'Eduardo Castex', 'Intendente Alvear', 'Macachín', 'Quemú Quemú',
    '25 de Mayo', 'Victorica', 'Catriló', 'Lonquimay',
    'Doblas', 'Ataliva Roca', 'Anguil', 'Winifreda',
    'Colonia Barón', 'Trenel', 'Bernasconi', 'Guatraché',
    'Miguel Riglos', 'Rancul', 'La Adela', 'Telén',
  ],

  // =========================================================================
  // LA RIOJA
  // =========================================================================
  'La Rioja': [
    'La Rioja', 'Chilecito', 'Aimogasta', 'Chamical', 'Chepes',
    'Olta', 'Villa Unión', 'Famatina', 'Anguinán', 'Nonogasta',
    'Vichigasta', 'Villa Sanagasta', 'Anillaco', 'Aminga',
    'Castro Barros', 'Patquía', 'Ulapes', 'Villa Castelli',
  ],

  // =========================================================================
  // MENDOZA
  // =========================================================================
  'Mendoza': [
    'Mendoza', 'Godoy Cruz', 'Las Heras', 'Guaymallén', 'Maipú', 'Luján de Cuyo',
    'San Rafael', 'General Alvear', 'San Martín', 'Rivadavia', 'Junín',
    'Tunuyán', 'Tupungato', 'San Carlos', 'La Consulta', 'Eugenio Bustos',
    'Malargüe',
    'Dorrego', 'Las Cuevas', 'Uspallata',
    'Chacras de Coria', 'Vistalba', 'Carrodilla', 'Mayor Drummond',
    'Coquimbito', 'Cruz de Piedra', 'General Gutiérrez',
    'Palmira', 'Rodeo del Medio', 'Rodeo de la Cruz',
  ],

  // =========================================================================
  // MISIONES
  // =========================================================================
  'Misiones': [
    'Posadas', 'Garupá', 'Eldorado', 'Oberá', 'Puerto Iguazú',
    'Apóstoles', 'Leandro N. Alem', 'San Vicente', 'Jardín América',
    'Aristóbulo del Valle', 'Montecarlo', 'Puerto Rico', 'Colonia Wanda',
    'Puerto Esperanza', 'Comandante Andresito',
    'San Pedro', 'San Javier', 'Concepción de la Sierra',
    'Santa Ana', 'Candelaria', 'San Ignacio', 'Capioví',
    'Campo Grande', 'Campo Viera', 'Dos de Mayo',
    'Profundidad', 'Mártires', 'Cerro Azul', '25 de Mayo',
  ],

  // =========================================================================
  // NEUQUÉN
  // =========================================================================
  'Neuquén': [
    'Neuquén', 'Plottier', 'Centenario', 'Cutral Có', 'Plaza Huincul',
    'Zapala', 'San Martín de los Andes', 'Junín de los Andes',
    'Villa La Angostura', 'Chos Malal', 'Rincón de los Sauces',
    'Senillosa', 'Añelo', 'Picún Leufú', 'Piedra del Águila',
    'Aluminé', 'Las Lajas', 'Loncopué', 'Andacollo', 'Huinganco',
    'San Patricio del Chañar', 'Villa Pehuenia',
    'Vista Alegre Norte', 'Vista Alegre Sur', 'Villa El Chocón',
    'Bajada del Agrio',
  ],

  // =========================================================================
  // RÍO NEGRO
  // =========================================================================
  'Río Negro': [
    'Viedma', 'San Carlos de Bariloche', 'General Roca', 'Cipolletti',
    'Villa Regina', 'Allen', 'Cinco Saltos', 'Catriel', 'Río Colorado',
    'Choele Choel', 'Lamarque', 'Luis Beltrán', 'Chimpay',
    'El Bolsón', 'Ingeniero Jacobacci', 'Los Menucos', 'Sierra Grande',
    'San Antonio Oeste', 'Las Grutas', 'Valcheta',
    'Cervantes', 'Mainqué', 'Ingeniero Luis A. Huergo',
    'General Fernández Oro', 'Contralmirante Cordero', 'Barda del Medio',
    'Pomona', 'Dina Huapi', 'Cona Niyeu',
  ],

  // =========================================================================
  // SALTA
  // =========================================================================
  'Salta': [
    'Salta', 'Villa San Lorenzo', 'Vaqueros', 'La Caldera',
    'San Ramón de la Nueva Orán', 'Tartagal', 'General Mosconi',
    'Profesor Salvador Mazza', 'Pichanal',
    'San José de Metán (Est. Metán)', 'Rosario de la Frontera',
    'Cafayate', 'San Carlos', 'Animaná', 'Angastaco',
    'Cachi', 'Molinos', 'La Poma',
    'Joaquín V. González', 'Las Lajitas', 'Apolinario Saravia',
    'Embarcación', 'Aguaray', 'Campo Quijano', 'Rosario de Lerma',
    'El Carril', 'Chicoana', 'La Merced', 'Cerrillos',
    'El Galpón', 'Río Piedras', 'El Quebrachal',
  ],

  // =========================================================================
  // SAN JUAN
  // =========================================================================
  'San Juan': [
    // El catálogo Georef de San Juan es esquelético; muchas cabeceras
    // de departamento (Pocito, Albardón, Sarmiento, Angaco, Ullum, Zonda,
    // Valle Fértil) no figuran como localidades. Listamos sólo lo que existe.
    'San Juan', 'Rivadavia', 'Chimbas', 'Rawson', 'Santa Lucía',
    'Caucete', '9 de Julio', 'Calingasta', 'Iglesia',
    'San José de Jáchal', 'Villa San Agustín',
    'Villa Aberastain', 'Villa Media Agua', 'Villa Mercedes',
  ],

  // =========================================================================
  // SAN LUIS
  // =========================================================================
  'San Luis': [
    'San Luis', 'Villa Mercedes', 'Juana Koslay', 'La Punta',
    'Justo Daract', 'Tilisarao', 'Concarán', 'Quines',
    'Merlo', 'Santa Rosa del Conlara', 'Villa de la Quebrada',
    'La Toma', 'Naschel', 'San Francisco del Monte de Oro',
    'Buena Esperanza', 'Unión', 'El Trapiche', 'Potrero de los Funes',
    'Nueva Galia', 'Luján', 'Carpintería', 'Cortaderas',
  ],

  // =========================================================================
  // SANTA CRUZ
  // =========================================================================
  'Santa Cruz': [
    'Río Gallegos', 'Caleta Olivia', 'Pico Truncado', 'Las Heras',
    'Puerto Deseado', 'Puerto San Julián', 'El Calafate', 'El Chaltén',
    'Yacimientos Río Turbio', '28 de Noviembre', 'Perito Moreno',
    'Los Antiguos',
    'Gobernador Gregores', 'Puerto Santa Cruz', 'Comandante Luis Piedrabuena',
    'Koluel Kaike', 'Tres Lagos', 'Bajo Caracoles', 'Cañadón Seco',
  ],

  // =========================================================================
  // SANTA FE
  // =========================================================================
  'Santa Fe': [
    'Santa Fe', 'Santo Tomé', 'Recreo', 'San José del Rincón',
    'Rosario', 'Villa Gobernador Gálvez', 'Granadero Baigorria',
    'Capitán Bermúdez', 'Pérez', 'Funes', 'Roldán', 'San Lorenzo',
    'Puerto General San Martín', 'Fray Luis Beltrán',
    'Rafaela', 'Sunchales', 'Esperanza', 'Frontera', 'San Jorge',
    'Cañada de Gómez', 'Casilda', 'Firmat', 'Villa Constitución',
    'San Cristóbal', 'Reconquista', 'Avellaneda', 'Vera',
    'Venado Tuerto', 'Rufino', 'Chovet', 'Carcarañá',
    'Las Rosas', 'Las Parejas', 'Armstrong', 'Tortugas',
    'Gálvez', 'Coronda', 'San Carlos Centro', 'Sastre',
    'San Justo', 'San Javier', 'Helvecia', 'Cayastá',
    'Ceres', 'Arroyo Seco', 'Pueblo Esther',
    'Santo Tomé', 'Laguna Paiva', 'San Genaro', 'Calchaquí',
    'Tostado', 'Suardi', 'María Juana',
  ],

  // =========================================================================
  // SANTIAGO DEL ESTERO
  // =========================================================================
  'Santiago del Estero': [
    'Santiago del Estero', 'La Banda', 'Termas de Río Hondo',
    'Frías', 'Añatuya', 'Quimili', 'Monte Quemado',
    'Suncho Corral', 'Bandera', 'Tintina', 'Selva',
    'Fernández', 'Beltrán', 'Ingeniero Forres', 'Garza',
    'Villa Ojo de Agua', 'Sumampa', 'Choya',
    'Clodomira', 'Pampa de los Guanacos', 'Los Telares',
  ],

  // =========================================================================
  // TIERRA DEL FUEGO — sólo 3 ciudades reales.
  // =========================================================================
  'Tierra del Fuego, Antártida e Islas del Atlántico Sur': [
    // El catálogo sólo lista Ushuaia y Río Grande. Tolhuin no figura.
    'Ushuaia', 'Río Grande',
  ],

  // =========================================================================
  // TUCUMÁN
  // =========================================================================
  'Tucumán': [
    'San Miguel de Tucumán', 'Yerba Buena - Marcos Paz', 'Tafí Viejo',
    'Banda del Río Salí', 'Alderetes', 'Lules', 'Bella Vista',
    'Famaillá', 'Concepción', 'Aguilares', 'Monteros', 'Tafí del Valle',
    'Simoca', 'Villa de Trancas', 'Villa Burruyacú', 'Graneros', 'La Cocha',
    'Juan Bautista Alberdi', 'Santa Ana', 'Delfín Gallo',
    'Los Ralos', 'El Manantial', 'Ingenio San Pablo', 'San Andrés',
    'Amaicha del Valle', 'El Mollar', 'Ranchillos',
  ],
}

/** Convierte el array `readonly string[]` en un Set para look-ups O(1). */
const PRINCIPALES: Record<string, ReadonlySet<string> | '*'> = Object.fromEntries(
  Object.entries(RAW).map(([prov, lista]) => [
    prov,
    lista === '*' ? '*' : new Set(lista),
  ]),
)

/**
 * ¿Tenemos lista curada de localidades principales para esta provincia?
 * Si no la tenemos, el modo eficiencia degrada graciosamente: se usan
 * todas las localidades (mismo comportamiento que sin filtrar).
 */
export function tieneFiltroPrincipales(provinciaNombre: string): boolean {
  return provinciaNombre in PRINCIPALES
}

/**
 * Filtra una lista de localidades dejando sólo las "principales" según el
 * dataset curado. Si no hay datos para la provincia, devuelve la lista
 * intacta (no rompe nunca). El sentinela `'*'` significa "todas son
 * principales" — útil para CABA y similares.
 */
export function filtrarPrincipales(
  provinciaNombre: string,
  localidades: readonly Localidad[],
): Localidad[] {
  const set = PRINCIPALES[provinciaNombre]
  if (!set) return [...localidades]
  if (set === '*') return [...localidades]
  return localidades.filter((l) => set.has(l.nombre))
}

/**
 * Cuenta cuántas localidades quedarían si aplicáramos el modo eficiencia
 * sobre toda la provincia. Útil para mostrar el ahorro en la UI.
 */
export function contarPrincipalesProvincia(provincia: Provincia): number {
  return filtrarPrincipales(provincia.nombre, provincia.localidades).length
}

/**
 * Total de localidades principales para todo un país (sumando provincias).
 */
export function contarPrincipalesPais(pais: Pais): number {
  let n = 0
  for (const prov of pais.provincias) {
    n += contarPrincipalesProvincia(prov)
  }
  return n
}

/** Total bruto de localidades en el país (todas, sin filtrar). */
export function contarLocalidadesPais(pais: Pais): number {
  let n = 0
  for (const prov of pais.provincias) {
    n += prov.localidades.length
  }
  return n
}

/**
 * Devuelve el listado RAW de candidatos por provincia (incluye nombres que
 * podrían no existir en el catálogo). Sólo lo usamos desde el script de
 * validación.
 */
export function _getRawCandidatos(): Record<string, ListaPrincipales> {
  return RAW
}
