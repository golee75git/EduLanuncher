import { Sun } from "lucide-react";

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
      <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-desk">
        <Sun className="home-sun h-4 w-4 shrink-0" aria-hidden="true" />
        {greetingForTime(now.getHours(), now.getMinutes())}
      </h2>
      <p className="mt-0.5 text-[11px] leading-4 text-quiet">오늘 필요한 업무를 빠르게 시작하세요.</p>
      <p className="text-[11px] leading-4 text-quiet">파일을 끌어 놓으면 다음에 할 일을 보여 줍니다.</p>
    </section>
  );
}
