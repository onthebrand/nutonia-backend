export const MODERATION_CONFIG = {
    // Strictness level: 'STRICT' | 'BALANCED' | 'PERMISSIVE'
    DEFAULT_STRICTNESS: 'BALANCED' as const,

    // Auto-suspension rules
    AUTO_SUSPEND: {
        ENABLED: true,
        RULES: {
            CRITICAL_VIOLATION: 168, // 7 days
            HIGH_AFTER_2: 72,        // 3 days after 2 violations
            MEDIUM_AFTER_3: 24,      // 1 day after 3 violations
            ANY_AFTER_5: 24,         // 1 day after 5 violations
        },
    },

    // Moderation categories
    CATEGORIES: {
        SEXUAL_CONTENT: {
            name: 'Contenido Sexual',
            description: 'Contenido sexual explícito o inapropiado',
            keywords: ['sexo', 'pornografía', 'desnudo', 'erótico', 'xxx'],
            educationalExceptions: ['educación sexual', 'anatomía', 'reproducción', 'biología'],
        },
        DRUGS: {
            name: 'Drogas',
            description: 'Contenido sobre drogas ilegales o abuso de sustancias',
            keywords: ['droga', 'cocaína', 'marihuana', 'heroína', 'metanfetamina', 'éxtasis'],
            educationalExceptions: ['historia de la medicina', 'farmacología', 'prevención', 'salud pública'],
        },
        VIOLENCE: {
            name: 'Violencia',
            description: 'Contenido violento o que promueva daño',
            keywords: ['matar', 'asesinar', 'tortura', 'suicidio', 'autolesión'],
            educationalExceptions: ['historia', 'prevención', 'salud mental', 'primeros auxilios'],
        },
        ADVERTISING: {
            name: 'Publicidad',
            description: 'Publicidad comercial o promoción de productos',
            keywords: ['compra', 'vende', 'oferta', 'descuento', 'promoción', 'precio'],
            educationalExceptions: ['economía', 'marketing educativo', 'análisis de mercado'],
        },
        POLITICAL: {
            name: 'Propaganda Política',
            description: 'Propaganda política partidista',
            keywords: ['vota por', 'candidato', 'partido político', 'elecciones'],
            educationalExceptions: ['ciencia política', 'historia política', 'sistema electoral', 'democracia'],
        },
        RELIGIOUS: {
            name: 'Proselitismo Religioso',
            description: 'Proselitismo religioso',
            keywords: ['convierte', 'salvación', 'pecado', 'infierno'],
            educationalExceptions: ['historia de las religiones', 'estudios religiosos', 'teología', 'filosofía'],
        },
        HATE_SPEECH: {
            name: 'Discurso de Odio',
            description: 'Discurso de odio o discriminación',
            keywords: ['odio', 'discriminación', 'racismo', 'xenofobia', 'homofobia'],
            educationalExceptions: ['derechos humanos', 'historia', 'sociología', 'prevención'],
        },
    },

    // Content policy text (user-facing)
    CONTENT_POLICY: {
        title: 'Política de Contenido Educativo',
        summary: 'Nutonia es una plataforma exclusivamente educativa. Todo el contenido debe tener un propósito educativo claro.',

        allowed: [
            'Contenido educativo sobre cualquier tema académico',
            'Explicaciones científicas, históricas, culturales',
            'Discusión educativa de temas sensibles en contexto apropiado',
            'Material didáctico y pedagógico',
        ],

        prohibited: [
            'Contenido sexual explícito o pornográfico',
            'Instrucciones para crear o usar drogas ilegales',
            'Contenido que promueva violencia o autolesión',
            'Publicidad comercial o promoción de productos',
            'Propaganda política partidista',
            'Proselitismo religioso',
            'Discurso de odio o discriminación',
            'Spam o contenido irrelevante',
        ],

        examples: {
            allowed: [
                '✅ "La historia de las drogas en la medicina moderna"',
                '✅ "Educación sexual: anatomía y reproducción humana"',
                '✅ "El impacto de la Revolución Francesa en la política"',
                '✅ "Las religiones del mundo: comparación histórica"',
            ],
            prohibited: [
                '❌ "Cómo hacer drogas caseras"',
                '❌ "Contenido sexual explícito"',
                '❌ "Compra nuestro producto ahora - 50% descuento"',
                '❌ "Vota por [partido político]"',
            ],
        },

        consequences: [
            '1ª violación: Advertencia',
            '2ª violación: Suspensión de 3 días',
            '3ª violación: Suspensión de 7 días',
            'Violaciones graves: Suspensión inmediata',
        ],
    },

    // AI Moderation Prompt Template
    MODERATION_PROMPT: `Eres un moderador de contenido educativo experto. Tu trabajo es analizar si un prompt es apropiado para una plataforma educativa.

**CONTEXTO**: Nutonia es una plataforma exclusivamente educativa. Los usuarios deben crear contenido con fines educativos.

**TU TAREA**: Analiza el siguiente prompt y determina si es apropiado.

**CRITERIOS**:

1. **PERMITIDO** (is_appropriate: true):
   - Contenido educativo legítimo sobre cualquier tema académico
   - Discusión educativa de temas sensibles en contexto apropiado
   - Ejemplos: "La historia de las drogas en la medicina", "Educación sexual: anatomía humana"

2. **NO PERMITIDO** (is_appropriate: false):
   - Contenido sexual explícito o pornográfico
   - Instrucciones para crear/usar drogas ilegales
   - Contenido que promueva violencia o autolesión
   - Publicidad comercial o promoción de productos
   - Propaganda política partidista
   - Proselitismo religioso
   - Discurso de odio o discriminación

**NIVEL DE ESTRICCIÓN**: BALANCED
- Permite discusión educativa de temas sensibles
- Bloquea uso no educativo de temas sensibles
- Usa contexto para determinar intención

**FORMATO DE RESPUESTA** (JSON):
{
  "is_appropriate": boolean,
  "confidence": number (0.0 a 1.0),
  "violated_categories": string[] (nombres de categorías violadas),
  "reasoning": string (explicación clara en español),
  "suggestion": string (cómo reformular si es inapropiado)
}

**PROMPT A ANALIZAR**:
{PROMPT}

Responde SOLO con el JSON, sin texto adicional.`,
};

export type ModerationCategory = keyof typeof MODERATION_CONFIG.CATEGORIES;
export type StrictnessLevel = 'STRICT' | 'BALANCED' | 'PERMISSIVE';
