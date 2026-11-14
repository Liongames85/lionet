# LIOnet bezpłatnie: GitHub Pages + GitHub Actions

Jeśli warunkiem jest **zero opłat i brak karty**, wybierz GitHub Pages + GitHub Actions. Repozytorium musi być publiczne na darmowym planie GitHub. Pages hostuje stronę, a Actions uruchamia własny crawler co 6 godzin i publikuje zaktualizowany indeks.

GitHub Pages nie jest klasyczną stale działającą maszyną: crawler pracuje partiami, a wyszukiwanie w opublikowanej wersji odbywa się w przeglądarce. To jest najbezpieczniejszy wariant całkowicie darmowy, ale mniej ciągły niż VM.

## Uruchomienie GitHub Pages

1. Załóż konto na [GitHub](https://github.com/signup).
2. Utwórz publiczne repozytorium o nazwie `lionet`.
3. Prześlij do niego cały projekt, w tym katalog `.github/workflows`.
4. Wejdź w `Settings → Pages` i jako źródło wybierz `GitHub Actions`.
5. Uruchom ręcznie workflow `Update LIOnet index` w zakładce `Actions`, aby od razu zasilić indeks.

Po pierwszym udanym workflow adres będzie w formie:

```text
https://TWOJ_LOGIN.github.io/lionet/
```

Workflow publikuje stronę z własnym rankingiem, obrazami i aktualnym indeksem. Crawler respektuje `robots.txt`; nie korzysta z DuckDuckGo.

## Wariant stale działający

Jeśli później zaakceptujesz konto z weryfikacją płatniczą, w repozytorium jest też gotowy wariant Docker dla Oracle Cloud Always Free. Oracle pozwala uruchomić pulę Ampere A1; przy pracy przez cały miesiąc bezpieczny start to około 2 OCPU i 12 GB RAM, zależnie od regionu i dostępnej pojemności.

Najlepszym wariantem z trwałym procesem jest **Oracle Cloud Always Free**: maszyna wirtualna może działać stale, a indeks i proces crawlera mogą zapisywać dane na dysku. Dostępność zależy od regionu i wolnej pojemności.

## 1. Załóż konto

Otwórz [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) i wybierz „Start for free”. Wybierz region najbliższy użytkownikom, a podczas tworzenia VM:

- obraz: Ubuntu 24.04;
- typ: Ampere A1, w zakresie Always Free;
- zasoby: na początek 2 OCPU i 12 GB RAM;
- dodaj klucz SSH i zachowaj plik klucza;
- przypisz publiczny adres IPv4.

Po utworzeniu maszyny dodaj w regułach sieci port TCP `4173` (tymczasowo do bezpośredniego testu). Później można dodać domenę i HTTPS przez Caddy.

## 2. Uruchom LIOnet

Na komputerze lokalnym skopiuj projekt na VM, np. przez Git lub SCP. Na serwerze wykonaj:

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Wyloguj się i zaloguj ponownie, potem w katalogu projektu:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f crawler
```

LIOnet będzie dostępny pod:

```text
http://PUBLICZNY_ADRES_IP:4173
```

Dane indeksu są trzymane w katalogu `data/` na VM, bo Compose montuje go jako trwały wolumen. Kontenery web i crawler uruchamiają się ponownie po restarcie maszyny.

## Ważne

Oracle wymaga jednej prawdziwej rejestracji i może poprosić o metodę płatności do weryfikacji. Nie przełączaj konta na płatne i wybieraj wyłącznie zasoby oznaczone **Always Free**. Darmowa pula może być czasowo niedostępna w wybranym regionie — wtedy wybierz inny region podczas tworzenia VM.
