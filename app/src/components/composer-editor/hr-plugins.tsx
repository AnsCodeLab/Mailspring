import React from 'react';
import { Editor } from 'slate';
import { BuildToggleButton } from './toolbar-component-factories';
import { BLOCK_CONFIG } from './base-block-plugins';
import { ComposerEditorPlugin } from './types';

export const HR_TYPE = 'hr';

function renderNode(props, editor: Editor = null, next = () => {}) {
  if (props.node.type === HR_TYPE) {
    return <hr {...props.attributes} />;
  }
  return next();
}

const rules = [
  {
    deserialize(el: HTMLElement, next) {
      if (el.tagName.toLowerCase() === 'hr') {
        return {
          object: 'block',
          type: HR_TYPE,
          nodes: [],
        };
      }
    },
    serialize(obj: any, children: any) {
      if (obj.object !== 'block') return;
      return renderNode({ node: obj, children, targetIsHTML: true });
    },
  },
];

// `hr` is a void block, so inserting it adjacent to the document edge or another void
// node can strand the cursor with no adjacent editable text. Always chain a trailing
// empty div (same pattern as BLOCK_CONFIG.code's insert button) to guarantee somewhere
// editable to land.
export function insertHorizontalRule(editor: Editor) {
  return editor.insertBlock(HR_TYPE).insertBlock(BLOCK_CONFIG.div.type);
}

const InsertHrButton = BuildToggleButton({
  type: 'hr',
  button: {
    isActive: () => false,
    onToggle: (editor) => insertHorizontalRule(editor),
    iconClass: 'fa fa-minus',
  },
});

const HrPlugin: ComposerEditorPlugin = {
  toolbarSectionClass: 'hr-section',
  toolbarComponents: [InsertHrButton],
  renderNode,
  rules,
};

const plugins: ComposerEditorPlugin[] = [HrPlugin];

export default plugins;
