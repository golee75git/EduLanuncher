export function greetingForTime(hour: number, minute: number): string {
  const minutes = hour * 60 + minute;
  if (minutes < 5 * 60 || minutes >= 17 * 60) {
    return "좋은 저녁이에요";
  }
  if (minutes >= 11 * 60 + 30 && minutes < 13 * 60) {
    return "즐거운 점심시간이에요";
  }
  if (minutes < 12 * 60) {
    return "좋은 아침이에요";
  }
  return "좋은 오후예요";
}

export function WelcomeMessage({ now = new Date() }: { now?: Date }) {
  return (
    <section className="px-7">
      <h2 className="text-[15px] font-bold text-desk">{greetingForTime(now.getHours(), now.getMinutes())}</h2>
      <p className="mt-0.5 text-[11px] text-quiet">오늘 필요한 업무를 빠르게 시작하세요.</p>
    </section>
  );
}
