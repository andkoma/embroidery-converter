'use strict';

/*
 * Embroidery Converter - UI translations (EN / DE / FR)
 * Copyright © 2024 orgware.ai (andkoma@akopp.de). Created with AI support.
 *
 * Static strings are applied via [data-i18n] attributes in index.html.
 * Dynamic strings are fetched with t(key, params) from renderer.js.
 * Params use {name} placeholders.
 */

const I18N = {
  en: {
    'app.subtitle': 'Convert stitch files between machine formats',
    'backend.checking': 'Checking backend…',
    'backend.ready.bundled': 'Bundled engine ready',
    'backend.ready.system': 'Conversion engine ready',
    'backend.unavailable': 'Engine unavailable',
    'backend.error': 'Engine error',

    'drop.title': 'Drag & drop embroidery files here',
    'drop.or': 'or',
    'drop.browse': 'browse files',
    'drop.formats': 'DST · PES · JEF · VP3 · HUS · XXX · EXP · SEW · U01 · and more',

    'files.title': 'Files',
    'files.clear': 'Clear all',
    'files.empty': 'No files added yet.',

    'out.format': 'Output format',
    'resize.title': 'Resize & resample',
    'resize.width': 'Width (mm)',
    'resize.height': 'Height (mm)',
    'resize.auto': 'auto',
    'resize.lock': 'Lock aspect ratio',
    'resize.resample': 'Resample stitches',
    'resize.resampleHint': '(keep stitch density when resizing)',
    'resize.reset': 'Reset to original size',

    'colors.title': 'Colors',
    'colors.limit': 'Limit color count',
    'colors.max': 'Max colors',
    'colors.palette': 'Palette',
    'colors.noInfo': 'No color info (add a file that stores colors).',
    'colors.noStore': '.{fmt} does not store thread colors — color info is dropped in this format.',

    'out.folder': 'Output folder',
    'out.choose': 'Choose…',
    'out.choosePh': 'Choose a folder…',
    'convert.btn': 'Convert',

    'status.ready': 'Ready',
    'status.converting': 'Converting',
    'status.done': 'Done',
    'status.error': 'Error',
    'status.showInFolder': 'Show in folder',
    'status.remove': 'Remove',

    'meta.reading': 'Reading…',
    'meta.stitches': '{n} stitches',
    'meta.colors': '{n} color',
    'meta.colors_plural': '{n} colors',
    'meta.size': '{w} × {h} mm',
    'meta.notes': '{n} note',
    'meta.notes_plural': '{n} notes',
    'meta.errorPrefix': 'Error: {msg}',

    'progress.converting': 'Converting {name}…',
    'progress.finished': 'Finished — {ok} converted, {failed} failed.',

    'preview.none': 'No preview',
  },

  de: {
    'app.subtitle': 'Stickdateien zwischen Maschinenformaten konvertieren',
    'backend.checking': 'Prüfe Backend…',
    'backend.ready.bundled': 'Integrierte Engine bereit',
    'backend.ready.system': 'Konvertierungs-Engine bereit',
    'backend.unavailable': 'Engine nicht verfügbar',
    'backend.error': 'Engine-Fehler',

    'drop.title': 'Stickdateien hierher ziehen & ablegen',
    'drop.or': 'oder',
    'drop.browse': 'Dateien auswählen',
    'drop.formats': 'DST · PES · JEF · VP3 · HUS · XXX · EXP · SEW · U01 · und mehr',

    'files.title': 'Dateien',
    'files.clear': 'Alle entfernen',
    'files.empty': 'Noch keine Dateien hinzugefügt.',

    'out.format': 'Ausgabeformat',
    'resize.title': 'Größe ändern & neu abtasten',
    'resize.width': 'Breite (mm)',
    'resize.height': 'Höhe (mm)',
    'resize.auto': 'auto',
    'resize.lock': 'Seitenverhältnis sperren',
    'resize.resample': 'Stiche neu abtasten',
    'resize.resampleHint': '(Stichdichte beim Skalieren beibehalten)',
    'resize.reset': 'Auf Originalgröße zurücksetzen',

    'colors.title': 'Farben',
    'colors.limit': 'Farbanzahl begrenzen',
    'colors.max': 'Max. Farben',
    'colors.palette': 'Palette',
    'colors.noInfo': 'Keine Farbinfos (Datei mit gespeicherten Farben hinzufügen).',
    'colors.noStore': '.{fmt} speichert keine Garnfarben — Farbinfos gehen in diesem Format verloren.',

    'out.folder': 'Ausgabeordner',
    'out.choose': 'Wählen…',
    'out.choosePh': 'Ordner wählen…',
    'convert.btn': 'Konvertieren',

    'status.ready': 'Bereit',
    'status.converting': 'Konvertiere',
    'status.done': 'Fertig',
    'status.error': 'Fehler',
    'status.showInFolder': 'Im Ordner anzeigen',
    'status.remove': 'Entfernen',

    'meta.reading': 'Lese…',
    'meta.stitches': '{n} Stiche',
    'meta.colors': '{n} Farbe',
    'meta.colors_plural': '{n} Farben',
    'meta.size': '{w} × {h} mm',
    'meta.notes': '{n} Hinweis',
    'meta.notes_plural': '{n} Hinweise',
    'meta.errorPrefix': 'Fehler: {msg}',

    'progress.converting': 'Konvertiere {name}…',
    'progress.finished': 'Fertig — {ok} konvertiert, {failed} fehlgeschlagen.',

    'preview.none': 'Keine Vorschau',
  },

  fr: {
    'app.subtitle': 'Convertir des fichiers de broderie entre formats machine',
    'backend.checking': 'Vérification du moteur…',
    'backend.ready.bundled': 'Moteur intégré prêt',
    'backend.ready.system': 'Moteur de conversion prêt',
    'backend.unavailable': 'Moteur indisponible',
    'backend.error': 'Erreur du moteur',

    'drop.title': 'Glissez-déposez vos fichiers de broderie ici',
    'drop.or': 'ou',
    'drop.browse': 'parcourir les fichiers',
    'drop.formats': 'DST · PES · JEF · VP3 · HUS · XXX · EXP · SEW · U01 · et plus',

    'files.title': 'Fichiers',
    'files.clear': 'Tout effacer',
    'files.empty': 'Aucun fichier ajouté.',

    'out.format': 'Format de sortie',
    'resize.title': 'Redimensionner & rééchantillonner',
    'resize.width': 'Largeur (mm)',
    'resize.height': 'Hauteur (mm)',
    'resize.auto': 'auto',
    'resize.lock': 'Verrouiller les proportions',
    'resize.resample': 'Rééchantillonner les points',
    'resize.resampleHint': '(conserver la densité de points lors du redimensionnement)',
    'resize.reset': 'Rétablir la taille d’origine',

    'colors.title': 'Couleurs',
    'colors.limit': 'Limiter le nombre de couleurs',
    'colors.max': 'Couleurs max',
    'colors.palette': 'Palette',
    'colors.noInfo': 'Aucune info couleur (ajoutez un fichier qui enregistre les couleurs).',
    'colors.noStore': '.{fmt} n’enregistre pas les couleurs de fil — les infos couleur sont perdues dans ce format.',

    'out.folder': 'Dossier de sortie',
    'out.choose': 'Choisir…',
    'out.choosePh': 'Choisir un dossier…',
    'convert.btn': 'Convertir',

    'status.ready': 'Prêt',
    'status.converting': 'Conversion',
    'status.done': 'Terminé',
    'status.error': 'Erreur',
    'status.showInFolder': 'Afficher dans le dossier',
    'status.remove': 'Retirer',

    'meta.reading': 'Lecture…',
    'meta.stitches': '{n} points',
    'meta.colors': '{n} couleur',
    'meta.colors_plural': '{n} couleurs',
    'meta.size': '{w} × {h} mm',
    'meta.notes': '{n} note',
    'meta.notes_plural': '{n} notes',
    'meta.errorPrefix': 'Erreur : {msg}',

    'progress.converting': 'Conversion de {name}…',
    'progress.finished': 'Terminé — {ok} converti(s), {failed} échec(s).',

    'preview.none': 'Aucun aperçu',
  },
};

// Expose to renderer.js (no module system in the renderer)
window.I18N = I18N;
