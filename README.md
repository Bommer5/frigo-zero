# 🧊 Frigo Zéro

Application web (PWA) gratuite et open source pour suivre les dates de péremption de ton frigo, sur **iPhone et Android**, sans compte, sans pub, sans IA.

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
- 🔗 **Partage du stock** par lien (coloc, famille)
- 💾 Export / import JSON, fonctionne **hors ligne**, mode sombre
- Les produits déjà scannés sont mémorisés (re-scan instantané, même hors ligne)

## Installer
- **iPhone** : ouvre le lien dans Safari → Partager ⬆️ → « Sur l'écran d'accueil »
- **Android** : ouvre le lien dans Chrome → « Installer l'application »

## Notifications
| | Android | iPhone (iOS 16.4+) |
|---|---|---|
| À l'ouverture de l'app | ✅ | ✅ |
| En arrière-plan sans serveur (Periodic Sync) | ✅ (app installée) | ❌ |
| Push via le serveur `server/` | ✅ | ✅ (app installée) |

Apple ne permet pas à une web app de programmer seule une notification : pour les rappels en arrière-plan sur iPhone, il faut le petit serveur de push.

### Serveur de push (facultatif)
```bash
cd server && docker build -t frigo-zero-push . && docker run -d -p 8787:8787 -v fz-state:/app/state frigo-zero-push
docker logs <conteneur>   # affiche la clé publique VAPID
```
Puis renseigne `pushServer` et `vapidPublicKey` dans `config.js`. Le serveur ne stocke que l'abonnement push et les noms/dates des produits.

## Technique
HTML/CSS/JS vanilla, aucune étape de build. Données dans `localStorage`. Scan : [html5-qrcode](https://github.com/mebjas/html5-qrcode) (ZXing). Inspiré de [Dispensa](https://f-droid.org/packages/eu.frigo.dispensa), Grocy et FridgeBuddy.

Développement local : `python3 -m http.server` puis http://localhost:8000.

## Licence
MIT. Données produits © contributeurs Open Food Facts, licence ODbL.
