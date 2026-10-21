export const SUPPORTED_LOCALE = 'pt-BR' as const;

export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'core',
  'glutes',
  'quadriceps',
  'hamstrings',
  'calves',
  'full_body',
  'other',
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_GROUP_LABELS_PT: Record<MuscleGroup, string> = {
  chest: 'Peito',
  back: 'Costas',
  shoulders: 'Ombros',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  forearms: 'Antebraços',
  core: 'Core',
  glutes: 'Glúteos',
  quadriceps: 'Quadríceps',
  hamstrings: 'Posteriores de coxa',
  calves: 'Panturrilhas',
  full_body: 'Corpo inteiro',
  other: 'Outro',
};

export const ACTIVITY_TYPES = ['strength', 'cardio', 'mobility', 'flexibility', 'other'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABELS_PT: Record<ActivityType, string> = {
  strength: 'Força',
  cardio: 'Aeróbico',
  mobility: 'Mobilidade',
  flexibility: 'Flexibilidade',
  other: 'Outro',
};

export const EQUIPMENT_TYPES = [
  'barbell',
  'dumbbell',
  'kettlebell',
  'machine',
  'cable',
  'bodyweight',
  'band',
  'bench',
  'pullup_bar',
  'treadmill',
  'bike',
  'elliptical',
  'other',
] as const;

export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export const EQUIPMENT_TYPE_LABELS_PT: Record<EquipmentType, string> = {
  barbell: 'Barra',
  dumbbell: 'Halter',
  kettlebell: 'Kettlebell',
  machine: 'Máquina',
  cable: 'Cabo',
  bodyweight: 'Peso corporal',
  band: 'Elástico',
  bench: 'Banco',
  pullup_bar: 'Barra fixa',
  treadmill: 'Esteira',
  bike: 'Bicicleta',
  elliptical: 'Elíptico',
  other: 'Outro',
};

export const CARDIO_ACTIVITIES = ['walk', 'run', 'bike', 'spinning', 'hiit', 'elliptical'] as const;
export type CardioActivity = (typeof CARDIO_ACTIVITIES)[number];

export const CARDIO_ACTIVITY_LABELS_PT: Record<CardioActivity, string> = {
  walk: 'Caminhada',
  run: 'Corrida',
  bike: 'Bicicleta',
  spinning: 'Spinning',
  hiit: 'HIIT',
  elliptical: 'Elíptico',
};

export const LOAD_TYPES = ['fixed', 'progressive', 'bodyweight', 'time'] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

export const LOAD_TYPE_LABELS_PT: Record<LoadType, string> = {
  fixed: 'Fixa',
  progressive: 'Progressiva',
  bodyweight: 'Peso corporal',
  time: 'Tempo',
};

export const PROGRESSIVE_LOAD_NOTE_PT =
  'Carga progressiva significa que a pessoa que montou a ficha marcou a carga como variável. O aplicativo não calcula nem sugere o próximo peso.';

export const PERCEIVED_LEVELS = [1, 2, 3, 4, 5] as const;
export type PerceivedLevel = (typeof PERCEIVED_LEVELS)[number];

export const PERCEIVED_LEVEL_LABELS_PT: Record<PerceivedLevel, string> = {
  1: 'Muito ruim',
  2: 'Ruim',
  3: 'Regular',
  4: 'Bom',
  5: 'Excelente',
};

export const PERCEIVED_LEVEL_EMOJI: Record<PerceivedLevel, string> = {
  1: '😞',
  2: '🙁',
  3: '😐',
  4: '🙂',
  5: '😄',
};

export const PERCEIVED_LEVEL_DISCLAIMER_PT =
  'Percepção sua sobre o exercício nesta sessão. Não diagnostica lesão, não define carga e não é prescrição.';

export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];

export const ISO_WEEKDAY_LABELS_PT: Record<IsoWeekday, string> = {
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado',
  7: 'Domingo',
};
