# LIOnet

LIOnet to własna wyszukiwarka stron i obrazów bez AI. LIOnet ma własny indeks, własny crawler, własną normalizację polskich słów i własny ranking wyników. Strony dodaje się przez panel „Dodaj stronę”, a po zindeksowaniu ich treść i obrazy są wyszukiwane lokalnie.

Panel „Dodaj stronę” uruchamia również kontrolowany crawler bez globalnego limitu. Korzysta on z przygotowanych polskich i zagranicznych domen, respektuje robots.txt i pokazuje postęp do pierwszego celu 10 000 stron, a potem może dalej rozszerzać indeks. W trybie produkcyjnym można uruchomić go także osobno:

## Uruchomienie

```bash
pnpm install
pnpm run dev
```

Tryb produkcyjny:

```bash
pnpm run build
pnpm start
```

Osobny proces indeksowania:

```bash
pnpm run crawl
```

Wyszukiwarka działa wtedy pod `http://127.0.0.1:4173`.

## Darmowe opublikowanie bez karty

Projekt zawiera również wariant GitHub Pages + GitHub Actions. Repozytorium musi być publiczne na darmowym planie GitHub. Pages publikuje interfejs, a workflow `crawl-index.yml` uruchamia własny crawler co kilka godzin i aktualizuje statyczny indeks. Szczegóły są w [deploy/README.md](deploy/README.md).
