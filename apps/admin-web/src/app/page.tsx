import { redirect } from "next/navigation";

// Раньше корень вёл в список пользователей — раздел, с которого рабочий день не
// начинается ни у кого. Начинается он с того, что просит внимания сегодня.
export default function HomePage(): never {
  redirect("/today");
}
