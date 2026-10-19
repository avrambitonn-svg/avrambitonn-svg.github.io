// הכתבה קולית בעברית דרך הדפדפן (Chrome, Edge, Safari). בלי שרת ובלי עלות.
type Rec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: (e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void
  onerror: (e: { error: string }) => void
  onend: () => void
  start: () => void
  stop: () => void
}

export function speechSupported() {
  return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
}

export function startDictation(onText: (finalText: string, interim: string) => void, onEnd: (error?: string) => void) {
  const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }
  const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition
  if (!Ctor) {
    onEnd('הדפדפן הזה לא תומך בהכתבה קולית')
    return () => {}
  }
  const r = new Ctor()
  r.lang = 'he-IL'
  r.continuous = true
  r.interimResults = true
  let finalText = ''
  r.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      if (res.isFinal) finalText += res[0].transcript + ' '
      else interim += res[0].transcript
    }
    onText(finalText.trim(), interim)
  }
  r.onerror = (e) => onEnd(e.error === 'not-allowed' ? 'אין הרשאה למיקרופון' : e.error)
  r.onend = () => onEnd()
  r.start()
  return () => r.stop()
}
