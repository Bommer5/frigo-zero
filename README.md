# 🧊 Frigo Zéro

Application web (PWA) gratuite et open source pour suivre les dates de péremption de ton frigo, sur **iPhone et Android**, connexion Google, frigo partagé, sans pub, sans IA.

**👉 Utiliser l'app : https://bommer5.github.io/frigo-zero/**

## Fonctionnalités
- 📷 **Scan du code-barres** (caméra ou photo) → nom, marque et photo via [Open Food Facts](https://world.openfoodfacts.org)
- 🍎 **Produits en vrac** en un clic (fruits, viande, restes…) avec durée de conservation suggérée
- 📅 **Dates rapides** (+3 j, +1 sem, +1 mois…) et distinction **DLC / DDM**
- 🧊 Emplacements : frigo, congélateur, placard, autre
- 🔴🟠 Tri par urgence, code couleur, recherche et filtre
- 😋 / 🗑️ « Consommé » ou « Jeté » (avec annulation), puis proposition de **racheter**
- 🛒 **Liste de courses**
- 📊 **Bilan anti-gaspi** : % de produits sauvés, ce que tu jettes le plus
- 🔔 **Rappels quotidiens** de péremption (voir ci-dessous)
- 👨‍👩‍👧 **Foyers partagés** avec invitations, synchro en temps réel
- 💾 Export des données, affichage **hors ligne**, mode sombre
- Les produits déjà scannés sont mémorisés (re-scan instantané, même hors ligne)

## Installer
- **iPhone** : ouvre le lien dans Safari → Partager ⬆️ → « Sur l'écran d'accueil »
- **Android** : ouvre le lien dans Chrome → « Installer l'application »

## Comptes, foyers et partage
- Connexion avec **Google** (Supabase Auth, flux PKCE). Aucun mot de passe stocké.
- Chaque utilisateur a un ou plusieurs **foyers** (« Mon frigo », « Kot », « Parents »…).
- **Inviter quelqu'un** : un lien valable 7 jours ; la personne se connecte et rejoint le foyer.
- Synchronisation **en temps réel** entre membres (Supabase Realtime).

## Notifications
Rappel quotidien à l'heure choisie, envoyé en **Web Push** (Android et iPhone iOS 16.4+ avec l'app installée).
Une fonction Edge (`supabase/functions/send-reminders`) est appelée toutes les 15 min par `pg_cron`.

## Sécurité & vie privée
- Postgres (Supabase, Francfort 🇪🇺), chiffré au repos (AES-256) et en transit (TLS).
- **Row Level Security** sur toutes les tables : on ne voit que les données de ses foyers.
- Fonctions `security definer` avec `search_path` vide, droits révoqués pour `anon`.
- Secrets (clé VAPID privée, secret cron) dans les secrets Supabase / Vault, jamais dans le dépôt.
- Content-Security-Policy stricte, échappement HTML systématique.
- RGPD : export des données et suppression du compte depuis l'app. [Politique de confidentialité](privacy.html)

## Technique
HTML/CSS/JS vanilla (modules ES), sans étape de build. Scan : [html5-qrcode](https://github.com/mebjas/html5-qrcode) (ZXing).
Données produits : [Open Food Facts](https://world.openfoodfacts.org). Inspiré de [Dispensa](https://f-droid.org/packages/eu.frigo.dispensa), Grocy, FridgeBuddy.

```
index.html, css/, js/       PWA
sw.js                       service worker (hors ligne + push)
supabase/migrations/        schéma SQL, RLS, fonctions
supabase/functions/         fonction Edge des rappels
```
Développement local : `python3 -m http.server 8765` puis http://localhost:8765.

## Licence
MIT. Données produits © contributeurs Open Food Facts, licence ODbL.
