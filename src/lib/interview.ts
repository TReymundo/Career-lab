/**
 * The "get to know you" interview: ten wide-open questions, each built to get as much as
 * possible out of one long answer — talk or type for as long as you like. The hints underneath
 * nudge towards what makes a story usable in a letter: what happened, what you did, how it
 * ended, numbers if you have them.
 */

export interface Q { id: string; theme: string; en: string; es: string; hints: { en: string; es: string } }

export const QUESTIONS: Q[] = [
  { id: 'q1', theme: 'you',
    en: 'Let’s start with you. Who are you, where are you from, and what does a normal week look like for you right now?',
    es: 'Arranquemos por vos. ¿Quién sos, de dónde sos, y cómo es una semana normal tuya ahora?',
    hints: { en: 'Age, where you live, what fills your days — classes, work, training, people.', es: 'Edad, dónde vivís, qué llena tus días — clases, trabajo, entrenamiento, gente.' } },
  { id: 'q2', theme: 'study',
    en: 'What have you learned so far — at school, at university, in courses or on your own — and what can you actually do now because of it?',
    es: '¿Qué aprendiste hasta ahora — en el colegio, la facultad, cursos o por tu cuenta — y qué sabés hacer de verdad gracias a eso?',
    hints: { en: 'Subjects you loved and ones that were hard, tools and software (Excel, Python, Canva…), languages and your level, a project you remember.', es: 'Materias que te encantaron y las que te costaron, herramientas y programas (Excel, Python, Canva…), idiomas y tu nivel, un proyecto que recuerdes.' } },
  { id: 'q3', theme: 'work',
    en: 'Tell me about every place you’ve worked or helped out — jobs, internships, freelance, a family business, selling things, volunteering. What did you do, and what changed because you were there?',
    es: 'Contame de cada lugar donde trabajaste o ayudaste — trabajos, pasantías, freelance, un negocio familiar, vender cosas, voluntariado. ¿Qué hacías, y qué cambió porque estabas ahí?',
    hints: { en: 'For each: where, when, your role, a normal day, the best thing you did — with numbers if you remember (customers, sales, hours, people).', es: 'Para cada uno: dónde, cuándo, tu rol, un día normal, lo mejor que hiciste — con números si te acordás (clientes, ventas, horas, gente).' } },
  { id: 'q4', theme: 'proud',
    en: 'What’s something you did that you’re genuinely proud of? Tell it like a story — the problem, what you did, how it ended.',
    es: '¿Qué hiciste de lo que estés orgulloso de verdad? Contalo como una historia — el problema, qué hiciste, cómo terminó.',
    hints: { en: 'School, work, sport, family, something you built or organised. Small is fine if it mattered to you.', es: 'Estudio, trabajo, deporte, familia, algo que armaste u organizaste. Chico está bien si a vos te importó.' } },
  { id: 'q5', theme: 'hard',
    en: 'What’s the hardest thing you’ve been through, and what did it change in you?',
    es: '¿Qué es lo más difícil que te tocó pasar, y qué cambió en vos?',
    hints: { en: 'A failure, a loss, a breakup, a bad year — how you got through it and what you do differently now. Personal parts stay private.', es: 'Algo que salió mal, una pérdida, una ruptura, un mal año — cómo saliste y qué hacés distinto ahora. Lo personal queda privado.' } },
  { id: 'q6', theme: 'people',
    en: 'When you work with other people, what role do you naturally take — and tell me about a time things went wrong between people and how you handled it.',
    es: 'Cuando trabajás con otra gente, ¿qué rol tomás naturalmente — y contame de una vez que las cosas se complicaron entre la gente y cómo lo manejaste.',
    hints: { en: 'Leading, organising, keeping the peace, doing the numbers… A team that worked, one that didn’t, someone you convinced.', es: 'Liderar, organizar, calmar las aguas, hacer los números… Un equipo que funcionó, uno que no, alguien a quien convenciste.' } },
  { id: 'q7', theme: 'life',
    en: 'What do you do when nobody is asking you to?',
    es: '¿Qué hacés cuando nadie te lo está pidiendo?',
    hints: { en: 'Sport, gym, music, instruments, games, side projects, reading, travel, friends — how often, since when, what it gives you.', es: 'Deporte, gimnasio, música, instrumentos, juegos, proyectos propios, leer, viajar, amigos — cada cuánto, desde cuándo, qué te da.' } },
  { id: 'q8', theme: 'self',
    en: 'What do people come to you for — and what are you still working on?',
    es: '¿Para qué te buscan los demás — y en qué todavía estás trabajando?',
    hints: { en: 'What friends, classmates or bosses ask you for help with. One honest weakness and what you’re doing about it.', es: 'En qué te piden ayuda amigos, compañeros o jefes. Una debilidad honesta y qué estás haciendo al respecto.' } },
  { id: 'q9', theme: 'ahead',
    en: 'Picture yourself three years from now, happy at work. What are you doing, where, with whom — and what would you never want in a job?',
    es: 'Imaginate dentro de tres años, contento en el trabajo. ¿Qué estás haciendo, dónde, con quién — y qué no querrías nunca en un trabajo?',
    hints: { en: 'The field, the kind of company, the kind of problems — and why that pulls you.', es: 'El área, el tipo de empresa, el tipo de problemas — y por qué te atrae.' } },
  { id: 'q10', theme: 'extra',
    en: 'Last one: what should I know about you that would never fit on a CV?',
    es: 'Última: ¿qué tendría que saber de vos que nunca entraría en un CV?',
    hints: { en: 'A quirk, a talent, a belief, the story you always tell, a person who shaped you.', es: 'Una manía, un talento, algo en lo que creés, la historia que siempre contás, una persona que te marcó.' } },
];

/** Answers already given to these exact questions (in either language). */
export const answeredIds = (answered: string[]) => {
  const set = new Set(answered);
  return new Set(QUESTIONS.filter((q) => set.has(q.en) || set.has(q.es)).map((q) => q.id));
};

/**
 * The friend's replies. Written, not generated — so the chat never waits on, or dies with, the
 * AI. Long answers get warmth, short ones a gentle nudge.
 */
export const REACTIONS = {
  long: {
    en: ['That’s gold — thank you for going deep.', 'Love this. Exactly the kind of detail that makes a letter sound like you.', 'Okay, that’s a great story.', 'Thanks for being that open — it really helps.', 'That says a lot about you, in a good way.'],
    es: ['Eso vale oro — gracias por contarlo tan completo.', 'Me encanta. Justo el tipo de detalle que hace que una carta suene a vos.', 'Uh, qué buena historia.', 'Gracias por abrirte así — ayuda un montón.', 'Eso dice mucho de vos, para bien.'],
  },
  short: {
    en: ['Got it.', 'Noted — short and sweet.', 'Okay! If more comes to mind later, you can always come back.'],
    es: ['Anotado.', 'Perfecto, corto y al pie.', '¡Dale! Si después se te ocurre más, podés volver cuando quieras.'],
  },
};
