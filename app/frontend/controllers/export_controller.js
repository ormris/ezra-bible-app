/* This file is part of Ezra Bible App.

   Copyright (C) 2019 - 2021 Ezra Bible App Development Team <contact@ezrabibleapp.net>

   Ezra Bible App is free software: you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation, either version 2 of the License, or
   (at your option) any later version.

   Ezra Bible App is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with Ezra Bible App. See the file LICENSE.
   If not, see <http://www.gnu.org/licenses/>. */

const marked = require('marked');
const i18nHelper = require('../helpers/i18n_helper.js');
const { parseHTML, decodeEntities } = require('../helpers/ezra_helper.js');

/**
 * The ExportController implements the export of certain verses with notes or tags into a Word document.
 *
 * @category Controller
 */


var exportFilePath;
var docx;

module.exports.showSaveDialog = async function (fileTitle) {
  if (platformHelper.isCordova()) return null; //TODO: figure out the way to save files in Cordova

  const dialog = require('electron').remote.dialog;
  var dialogOptions = getExportDialogOptions(fileTitle);

  return dialog.showSaveDialog(null, dialogOptions).then(result => {
    exportFilePath = result.filePath;

    if (!result.canceled && exportFilePath != undefined) {
      return exportFilePath;
    } else {
      return null;
    }
  });
};

module.exports.saveWordDocument = async function (title, verses, bibleBooks=undefined, notes={}) {
  if (!exportFilePath) {
    console.log('Export error: exportFilePath is not defined with showSaveDialog()');
  }

  docx = require("docx");

  var children = [];

  if (bibleBooks && Array.isArray(bibleBooks)) {
    
    children.push(...renderMarkdown(`# ${title}`));

    for (const currentBook of bibleBooks) {

      const bookTitle = await i18nHelper.getSwordTranslation(currentBook.longTitle);

      const allBlocks = getBibleBookVerseBlocks(currentBook, verses);
      const blockParagraphs = await renderVerseBlocks(allBlocks, currentBook, notes);

      children.push(
        new docx.Paragraph({
          text: bookTitle,
          heading: docx.HeadingLevel.HEADING_2,
        }),
        ...blockParagraphs
      );
    }

  } else {

    const titleP = new docx.Paragraph({
      text: title,
      heading: docx.HeadingLevel.TITLE
    });

    const allBlocks = getBookBlockByChapter(verses);
    const chapterParagraphs = await renderVerseBlocks(allBlocks, undefined, notes);
    children.push(titleP, ...chapterParagraphs);

  }

  const footers = await addBibleTranslationInfo();

  const titleFragment = parseHTML(marked(title));

  var doc = new docx.Document({
    title: titleFragment.textContent,
    creator: 'Ezra Bible App',
    description: 'Automatically generated by Ezra Bible App',
    styles: getDocStyles(),
    numbering: getNumberingConfig(),
    sections: [{
      properties: getPageProps(),
      children,
      footers,
    }],
  });

  console.log("Generating word document " + exportFilePath);
  const buffer = await docx.Packer.toBuffer(doc);

  const fs = require('fs/promises');
  await fs.writeFile(exportFilePath, buffer);

  const shell = require('electron').shell;
  shell.openPath(exportFilePath);
};


function getExportDialogOptions(title) {
  const app = require('electron').remote.app;
  var today = new Date();
  var month = getPaddedNumber(today.getMonth() + 1);
  var day = getPaddedNumber(today.getDate());
  var date = today.getFullYear() + '_' + month + '_' + day;
  var fileName = date + '__' + title + '.docx';

  var dialogOptions = {
    defaultPath: app.getPath('documents') + '/' + fileName,
    title: i18n.t("tags.export-tagged-verse-list"),
    buttonLabel: i18n.t("tags.run-export")
  };

  return dialogOptions;
}

function getPaddedNumber(number) {
  var paddedNumber = "" + number;
  if (number < 10) {
    paddedNumber = "0" + number;
  }
  return paddedNumber;
}

function getBibleBookVerseBlocks(bibleBook, verses) {
  var lastVerseNr = 0;
  var allBlocks = [];
  var currentBlock = [];

  // Transform the list of verses into a list of verse blocks (verses that belong together)
  for (let j = 0; j < verses.length; j++) {
    const currentVerse = verses[j];

    if (currentVerse.bibleBookShortTitle == bibleBook.shortTitle) {

      if (currentVerse.absoluteVerseNr > (lastVerseNr + 1)) {
        if (currentBlock.length > 0) {
          allBlocks.push(currentBlock);
        }
        currentBlock = [];
      }

      currentBlock.push(currentVerse);
      lastVerseNr = currentVerse.absoluteVerseNr;
    }
  }

  allBlocks.push(currentBlock);

  return allBlocks;
}

function getBookBlockByChapter(verses) {
  var prevVerseChapter;
  var allBlocks = [];
  var currentBlock = [];

  for (const currentVerse of verses) {

    if (currentVerse.chapter != prevVerseChapter) {
      prevVerseChapter = currentVerse.chapter;
      if (currentBlock.length > 0) {
        allBlocks.push(currentBlock);
        currentBlock = [];
      }
    }

    currentBlock.push(currentVerse);
  }

  allBlocks.push(currentBlock);

  return allBlocks;
}

async function renderVerseBlocks(verseBlocks, bibleBook=undefined, notes={}) {
  const bibleTranslationId = app_controller.tab_controller.getTab().getBibleTranslationId();
  const separator = await i18nHelper.getReferenceSeparator(bibleTranslationId);
  const chapterText = i18nHelper.getChapterText(undefined, bibleBook || verseBlocks[0][0].bibleBookShortTitle);

  var paragraphs = [];

  for (let j = 0; j < verseBlocks.length; j++) {
    const currentBlock = verseBlocks[j];


    if (bibleBook) { // render as tags
      paragraphs.push(...(await renderTagVerseLayout(currentBlock, bibleBook, separator)));
    } else { // render as notes
      const isFirstChapter = j === 0;
      const isMultipleChapters = verseBlocks.length > 1;
      paragraphs.push(...renderNotesVerseLayout(currentBlock, notes, isFirstChapter, isMultipleChapters, chapterText));
    }
  }

  return paragraphs;
}

async function renderTagVerseLayout(verses, bibleBook, separator=":") {

  const firstVerse = verses[0];
  const lastVerse = verses[verses.length - 1];

  // Output the verse reference of this block
  const bookTitle = await i18nHelper.getSwordTranslation(bibleBook.longTitle);
  const firstRef = `${firstVerse.chapter}${separator}${firstVerse.verseNr}`;

  let secondRef = "";
  if (verses.length >= 2) { // At least 2 verses, a bigger block
    if (lastVerse.chapter == firstVerse.chapter) {
      secondRef = "-" + lastVerse.verseNr;
    } else {
      secondRef = " - " + lastVerse.chapter + separator + lastVerse.verseNr;
    }        
  }

  var paragraphs = [new docx.Paragraph({
    text: `${bookTitle} ${firstRef}${secondRef}`,
    heading: docx.HeadingLevel.HEADING_3,
    spacing: {before: 200},
  })];

  const verseParagraphs = verses.map(renderVerse);
  paragraphs.push(...verseParagraphs);

  return paragraphs;
}

function renderNotesVerseLayout(currentBlock, notes, isFirstChapter, isMultipleChapters, chapterText) {
  const firstVerse = currentBlock[0];

  var paragraphs = [];

  if (isFirstChapter) {
    const bookReferenceId = firstVerse.bibleBookShortTitle.toLowerCase();
    if (notes[bookReferenceId]) {
      paragraphs.push(...renderMarkdown(notes[bookReferenceId].text, 'notes'));
    }
  }

  if (isMultipleChapters) { // Output chapter reference
    paragraphs.push(new docx.Paragraph({
      text: `${chapterText} ${firstVerse.chapter}`,
      heading: docx.HeadingLevel.HEADING_3,
    }));
  }

  const table = new docx.Table({
    rows: currentBlock.map(verse => {
      const referenceId = `${verse.bibleBookShortTitle.toLowerCase()}-${verse.absoluteVerseNr}`;

      return new docx.TableRow({
        children: [
          new docx.TableCell({
            children: [renderVerse(verse)],
            width: {
              type: docx.WidthType.DXA,
              size: docx.convertMillimetersToTwip(95)
            },
          }),
          new docx.TableCell({
            children: notes[referenceId] ? renderMarkdown(notes[referenceId].text, 'notes') : [],
            width: {
              type: docx.WidthType.DXA,
              size: docx.convertMillimetersToTwip(95)
            },
          })
        ],
        cantSplit: true
      });
    }),
    margins: {
      marginUnitType: docx.WidthType.DXA,
      top: docx.convertMillimetersToTwip(2),
      bottom: docx.convertMillimetersToTwip(2),
      left: docx.convertMillimetersToTwip(2),
      right: docx.convertMillimetersToTwip(2),
    },
    width: {
      type: docx.WidthType.DXA,
      size: docx.convertMillimetersToTwip(190)
    },
    columnWidths: [docx.convertMillimetersToTwip(95), docx.convertMillimetersToTwip(95)],

  });

  paragraphs.push(table);

  return paragraphs;
}

function renderVerse(verse) {

  let currentVerseContent = "";
  const fixedContent = verse.content.replace(/<([a-z]+)(\s?[^>]*?)\/>/g, '<$1$2></$1>'); // replace self clothing tags FIXME: Should it be in the NSI?
  const currentVerseNodes = Array.from(parseHTML(fixedContent).childNodes);

  currentVerseContent = currentVerseNodes.reduce((prevContent, currentNode) => {
    // We export everything that is not a DIV
    // DIV elements contain markup that should not be in the word document
    return currentNode.nodeName !== 'DIV' ? prevContent + currentNode.textContent : prevContent;
  }, "");

  return new docx.Paragraph({
    children: [
      new docx.TextRun({text: verse.verseNr, superScript: true}),
      new docx.TextRun(" " + currentVerseContent)
    ]
  });

}

function renderMarkdown(markdown, style=undefined) {
  var paragraphs = [];
  var currentParagraphText = [];
  var isOrderedList = false;
  var isBlockquote = false;

  convertMarkDownTokens(marked.lexer(markdown));

  // https://marked.js.org/using_pro#lexer
  function convertMarkDownTokens(tokenArr, currentOptions={}) {
    for (const token of tokenArr) {
      let textOptions = {};
      switch (token.type) { // check for inline types
        case 'em':
          textOptions.italics = true;
          break;
        case 'strong':
          textOptions.bold = true;
          break;
        case 'codespan':
          textOptions.highlight = 'yellow';
          break;
        case 'link':
          currentParagraphText.push(new docx.ExternalHyperlink({ 
            child: new docx.TextRun({text: token.text,  style: 'Hyperlink'}),
            link: token.href
          }));
          continue;
        case 'list':
          isOrderedList = token.ordered;
          break;
        case 'blockquote':
          isBlockquote = true;  
      }

      if (token.tokens) {
        convertMarkDownTokens(token.tokens, { ...currentOptions, ...textOptions });
      } else if (token.items) {
        convertMarkDownTokens(token.items, { ...currentOptions, ...textOptions });  
      } else if (token.text) {
        currentParagraphText.push(new docx.TextRun({text: decodeEntities(token.text), ...currentOptions, ...textOptions }));
        continue;
      }

      switch (token.type) { // check for block types
        case 'paragraph':
          paragraphs.push(new docx.Paragraph({children: currentParagraphText, style: isBlockquote ? 'blockquote' : style}));
          currentParagraphText = [];
          break;
        case 'heading':
          paragraphs.push(new docx.Paragraph({
            children: currentParagraphText,
            heading: docx.HeadingLevel[`HEADING_${token.depth}`],
          }));
          currentParagraphText = [];
          break;
        case 'blockquote':
          isBlockquote = false;
          break;
        case 'list_item': 
          paragraphs.push(new docx.Paragraph({
            children: currentParagraphText,
            style,
            numbering: {
              reference: isOrderedList ? 'custom-numbers' : 'custom-bullets',
              level: 0
            }
          }));
          currentParagraphText = [];
          break;
        case 'hr':
          paragraphs.push(new docx.Paragraph({
            text: "",
            border: {
              bottom: {
                color: "auto",
                space: 1,
                value: "single",
                size: 6,
              },
            },
            spacing: { after: 150 },
          }));
          break;
        case 'space':
          paragraphs.push(new docx.Paragraph(""));
          break;
        case 'link':
          paragraphs.push(new docx.Paragraph({
            children: [new docx.ExternalHyperlink({ 
              children: currentParagraphText,
              link: token.href
            })]
          }));
          currentParagraphText = [];
          break;
      }
    }
  }

  return paragraphs;
}

async function addBibleTranslationInfo() {
  const bibleTranslationId = app_controller.tab_controller.getTab().getBibleTranslationId();
  const swordModule = await ipcNsi.getLocalModule(bibleTranslationId);
  const copyright = swordModule.shortCopyright || swordModule.copyright;

  const children = [
    new docx.TextRun(`${i18n.t("general.scripture-quote-from")} `),
    new docx.TextRun({ text: swordModule.description, bold: true }),
    swordModule.distributionLicense ? new docx.TextRun(` (${swordModule.distributionLicense})`) : undefined,
    copyright ? new docx.TextRun({ text: copyright, break: 1 }) : undefined
  ];

  return {
    default: new docx.Footer({
      children: [
        new docx.Paragraph({
          children
        })
      ]
    })
  };
}

function getPageProps() {
  return {
    page: {
      margin: {
        top: docx.convertMillimetersToTwip(10),
        right: docx.convertMillimetersToTwip(10),
        bottom: docx.convertMillimetersToTwip(10),
        left: docx.convertMillimetersToTwip(10),
      },
    },
  };
}

function getNumberingConfig() {
  return {
    config: [{
      reference: "custom-bullets",
      levels: [
        {
          level: 0,
          format: docx.LevelFormat.BULLET,
          text: "•",
          alignment: docx.AlignmentType.LEFT,
          style: {
            paragraph: {
              indent: { left: 300, hanging: 150 },
            },
          },
        },
      ],
    }, {
      reference: "custom-numbers",
      levels: [
        {
          level: 0,
          format: docx.LevelFormat.DECIMAL,
          text: "%1.",
          alignment: docx.AlignmentType.START,
          style: {
            paragraph: {
              indent: { left: 300, hanging: 250 },
            },
          },
        },
      ]
    }]};
}

function getDocStyles() {
  return {
    default: {
      title: {
        run: {
          size: 32,
          bold: true,
          color: "FF0000",
        },
        paragraph: {
          spacing: {
            after: docx.convertMillimetersToTwip(5),
          }
        }
      },
      heading1: {
        run: {
          size: 28,
          bold: true,
          italics: true,
          color: "FF0000",
        },
        paragraph: {
          spacing: {
            after: 120,
          },
        },
      },
      heading2: {
        run: {
          size: 26,
          bold: true,
          underline: {
            type: docx.UnderlineType.DOUBLE,
            color: "FF0000",
          },
        },
        paragraph: {
          spacing: {
            before: 240,
            after: 120,
          },
        },
      },
      listParagraph: {
        run: {
          color: "FF0000",
        },
      },
    },
    paragraphStyles: [
      {
        id: "notes",
        name: "Notes",
        basedOn: "Normal",
        next: "Notes",
        quickFormat: true,
        run: {
          color: "2779AA",
        },
        paragraph: {
        },
      },
      {
        id: "blockquote",
        name: "BlockQuote",
        basedOn: "Notes",
        next: "Notes",
        quickFormat: true,
        run: {
          size: 22,
        },
        paragraph: {
          indent: {
            left: docx.convertMillimetersToTwip(10),
          },
          spacing: { before: docx.convertMillimetersToTwip(3), after: docx.convertMillimetersToTwip(3) },
          border: {
            left: {
              color: "BBBBBB",
              space: 20,
              value: "single",
              size: 12
            }
          }
        },
      },
    ],
  };
}
