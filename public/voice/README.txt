Recorded voice lines (optional)
==============================

Put MP3 files here and the app plays them instead of the browser's built-in voice.
Any line without a file falls back to the browser voice automatically.

  public/voice/en/<id>.mp3     English
  public/voice/es/<id>.mp3     Spanish

Ids:
  tour-1 … tour-8     the welcome tour, in order
  hello               the interview's first greeting
  welcome-back        the greeting when someone returns to the interview
  q1 … q10            the ten interview questions (see src/lib/interview.ts for the text)
  done                the line after the last question
