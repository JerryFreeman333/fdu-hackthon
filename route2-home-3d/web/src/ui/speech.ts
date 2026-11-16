import type { ItemInfo } from "../types";

/**
 * 找东西的语音指引。只朗读已经展示在界面上的文字，不额外生成位置或医嘱。
 * 浏览器不支持 speechSynthesis 时静默返回 false，视觉指引不受影响。
 */
export function buildItemSpeech(item: ItemInfo): string {
  return `找到${item.title}。${item.location}。${item.say}`;
}

export function speakGuide(text: string): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window))
    return false;
  if (typeof SpeechSynthesisUtterance === "undefined") return false;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
