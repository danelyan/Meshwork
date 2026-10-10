import { redirect } from 'next/navigation';

/**
 * Прежний адрес помощника по подбору. Решение владельца 10.10: дом работодателя — лента /consultant
 * (знакомство, затем помощник по подбору в той же ленте). Здесь только редирект для старых ссылок.
 */
export default function EmployerAssistantPage(): never {
  redirect('/consultant');
}
