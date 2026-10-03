/**
 * The "get to know you" interview: ten wide-open questions, each built to get as much as
 * possible out of one long answer — talk or type for as long as you like. The hints underneath
 * nudge towards what makes a story usable in a letter: what happened, what you did, how it
 * ended, numbers if you have them.
 */

export interface Q { id: string; theme: string; en: string; es: string; hints: { en: string; es: string } }

export const QUESTIONS: Q[] = [
  { id: 'q1', theme: 'you',
    en: 'Tell me about yourself like you would to a new friend.',
    es: 'Contame de vos como se lo contarías a un amigo nuevo.',
    hints: { en: 'Where you’re from, how old you are, what a normal day looks like, what you’re into right now.', es: 'De dónde sos, cuántos años tenés, cómo es un día normal tuyo, en qué andás ahora.' } },
  { id: 'q2', theme: 'study',
    en: 'Walk me through what you’ve studied and learned — in class and on your own.',
    es: 'Contame qué estudiaste y aprendiste — en clase y por tu cuenta.',
    hints: { en: 'Why you chose it, what came easy, what was hard and how you got through it, tools or skills you picked up, projects you remember.', es: 'Por qué lo elegiste, qué te salió fácil, qué te costó y cómo lo sacaste, herramientas o habilidades que aprendiste, proyectos que te acuerdes.' } },
  { id: 'q3', theme: 'work',
    en: 'Tell me about every job, gig or project you’ve had — anything where you worked, earned money or helped out.',
    es: 'Contame de cada trabajo, changa o proyecto que tuviste — cualquier cosa donde trabajaste, ganaste plata o ayudaste.',
    hints: { en: 'What you actually did day to day, the best thing you did there, and what came out of it — numbers if you remember (people, sales, hours, results).', es: 'Qué hacías día a día, lo mejor que hiciste ahí, y qué salió de eso — números si te acordás (gente, ventas, horas, resultados).' } },
  { id: 'q4', theme: 'proud',
    en: 'What are you proudest of so far? Tell me the whole story.',
    es: '¿De qué estás más orgulloso hasta ahora? Contame la historia entera.',
    hints: { en: 'Anything — school, work, sport, family, something you built. What was the situation, what did you do, how did it end?', es: 'Lo que sea — estudio, trabajo, deporte, familia, algo que armaste. ¿Cuál era la situación, qué hiciste, cómo terminó?' } },
  { id: 'q5', theme: 'hard',
    en: 'What’s the hardest thing you’ve been through, and how did you come out of it?',
    es: '¿Qué es lo más difícil que te tocó pasar, y cómo saliste?',
    hints: { en: 'At school, at work or in life — a failure, a loss, a breakup, a bad year. What changed in you after it? Share only what you want; personal parts stay private.', es: 'En el estudio, el trabajo o la vida — algo que salió mal, una pérdida, una ruptura, un mal año. ¿Qué cambió en vos después? Contá sólo lo que quieras; lo personal queda privado.' } },
  { id: 'q6', theme: 'people',
    en: 'Tell me about you with other people — teams, friends, leading, disagreeing.',
    es: 'Contame de vos con otra gente — equipos, amigos, liderar, no estar de acuerdo.',
    hints: { en: 'A team that worked and one that didn’t, a time you led something or convinced someone, a time you had a conflict and how it ended.', es: 'Un equipo que funcionó y uno que no, una vez que lideraste algo o convenciste a alguien, un conflicto y cómo terminó.' } },
  { id: 'q7', theme: 'life',
    en: 'What does your life look like outside work and study?',
    es: '¿Cómo es tu vida fuera del trabajo y el estudio?',
    hints: { en: 'Sport, gym, music, instruments, games, travel, volunteering, family, friends — how often, since when, and what you get out of it.', es: 'Deporte, gimnasio, música, instrumentos, juegos, viajes, voluntariado, familia, amigos — cada cuánto, desde cuándo, y qué te deja.' } },
  { id: 'q8', theme: 'self',
    en: 'What are you genuinely good at — and what are you still working on?',
    es: '¿En qué sos bueno de verdad — y en qué todavía estás trabajando?',
    hints: { en: 'Be honest. An example for each helps more than adjectives. What would the people around you say?', es: 'Sé honesto. Un ejemplo de cada cosa ayuda más que los adjetivos. ¿Qué diría la gente que te rodea?' } },
  { id: 'q9', theme: 'ahead',
    en: 'Where do you want to go from here?',
    es: '¿A dónde querés llegar desde acá?',
    hints: { en: 'The kind of work, companies or industries that pull you and why, where you see yourself in a few years, and what you’d never want in a job.', es: 'El tipo de trabajo, empresas o industrias que te atraen y por qué, dónde te ves en unos años, y qué no querrías nunca en un trabajo.' } },
  { id: 'q10', theme: 'extra',
    en: 'Anything else I should know about you — something that doesn’t fit on a CV but explains who you are?',
    es: '¿Algo más que tenga que saber de vos — algo que no entra en un CV pero explica quién sos?',
    hints: { en: 'A quirk, a talent, a belief, a story you always tell, a person who shaped you.', es: 'Una manía, un talento, algo en lo que creés, una historia que siempre contás, una persona que te marcó.' } },
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
