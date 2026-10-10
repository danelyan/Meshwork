import { redirect } from 'next/navigation';

/**
 * Прежний адрес онбординга. Решение владельца 10.10: один адрес с чатом — согласие, роль, шаги
 * знакомства и дальше консультант (или помощник по подбору) идут в ленте /consultant.
 * Здесь только редирект для старых ссылок и закладок.
 */
export default function OnboardingPage(): never {
  redirect('/consultant');
}
