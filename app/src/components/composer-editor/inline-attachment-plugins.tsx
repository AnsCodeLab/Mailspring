import React from 'react';
import { ImageAttachmentItem } from 'mailspring-component-kit';
import { Actions, AttachmentStore } from 'mailspring-exports';
import { File as MailspringFile } from '../../flux/models/file';
import { isQuoteNode } from './base-block-plugins';
import { BuildToggleButton } from './toolbar-component-factories';
import { ComposerEditorPlugin } from './types';
import { Editor, Inline, Node } from 'slate';
import { schema } from './conversion';

export const IMAGE_TYPE = 'image';

function ImageNode(props) {
  const { attributes, node, editor, targetIsHTML, isFocused } = props;
  const contentId = node.data.get ? node.data.get('contentId') : node.data.contentId,
    imgProps = node.data.get ? node.data.get('imgProps') : node.data.imgProps;

  if (targetIsHTML) {
    return (
      <img alt="" src={`cid:${contentId}`} width={imgProps?.width} height={imgProps?.height} />
    );
  }

  const { draft } = editor.props.propsForPlugins;
  const file = draft.files.find((f) => contentId === f.contentId);
  if (!file) {
    return <span />;
  }

  return (
    <ImageAttachmentItem
      {...attributes}
      className={`file-upload custom-block ${isFocused && 'focused'}`}
      filePath={AttachmentStore.pathForFile(file)}
      displayName={file.filename}
      onRemoveAttachment={() => editor.removeNodeByKey(node.key)}
      imgProps={imgProps}
      onResized={(width, height) => {
        const e = editor as Editor,
          n = node as Inline,
          newN = {
            key: n.key,
            object: n.object,
            data: n.data.asMutable(),
            type: n.type,
            nodes: n.nodes.asMutable(),
          };

        newN.data = newN.data.set('imgProps', { width: width, height: height });

        e.setNodeByKey(n.key, newN);
      }}
    />
  );
}

function renderNode(props, editor: Editor = null, next = () => {}) {
  if (props.node.type === IMAGE_TYPE) {
    return ImageNode(props);
  }
  return next();
}

const rules = [
  {
    deserialize(el: HTMLElement, next) {
      if (el.tagName.toLowerCase() === 'img')
        if ((el.getAttribute('src') || '').startsWith('cid:')) {
          return {
            object: 'inline',
            nodes: [],
            type: IMAGE_TYPE,
            data: {
              contentId: el.getAttribute('src').split('cid:').pop(),
              imgProps: {
                width: Number.parseInt(el.getAttribute('width')),
                height: Number.parseInt(el.getAttribute('height')),
              },
            },
          };
        }
    },
    serialize(obj: any, children: any) {
      if (obj.object !== 'inline') return;
      return renderNode({ node: obj, children, targetIsHTML: true });
    },
  },
];

export const changes = {
  insert: (editor: Editor, file: MailspringFile) => {
    const canHoldInline = (node: Node) => {
      const isVoid =
        node.object === 'inline' && schema.inlines[node.type] && schema.inlines[node.type].isVoid;
      return !isVoid && !isQuoteNode(node) && !!node.getFirstText();
    };

    while (!canHoldInline(editor.value.anchorBlock)) {
      editor.moveToEndOfPreviousText();
      if (!editor.value.anchorBlock) {
        break;
      }
    }
    return editor.insertInline({
      object: 'inline',
      type: IMAGE_TYPE,
      data: {
        contentId: file.contentId,
      },
    });
  },
};

const InsertImageButton = BuildToggleButton({
  type: 'image',
  button: {
    isActive: () => false,
    onToggle: (editor: Editor) => {
      const { draft } = editor.props.propsForPlugins;
      AppEnv.showOpenDialog(
        {
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }],
        },
        (paths) => {
          if (!paths || !paths.length) return;
          Actions.addAttachment({
            filePath: paths[0],
            headerMessageId: draft.headerMessageId,
            inline: true,
            onCreated: (file: MailspringFile) => changes.insert(editor, file),
          });
        }
      );
    },
    iconClass: 'fa fa-image',
  },
});

const plugins: ComposerEditorPlugin[] = [
  {
    renderNode,
    rules,
    toolbarComponents: [InsertImageButton],
  },
];

export default plugins;
