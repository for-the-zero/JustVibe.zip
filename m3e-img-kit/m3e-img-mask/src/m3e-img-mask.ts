import { LitElement, html, css, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import '@m3e/web/skeleton';
import '@m3e/web/loading-indicator';

export type M3eImgOpenDetail = { target: M3eImgMask };

export class M3eImgMask extends LitElement {
  @property({ type: String }) src = '';
  @property({ type: String }) alt = '';
  @property({ type: String }) title = '';
  @property({ type: String }) width = '';
  @property({ type: String }) height = '';
  @property({
    type: Boolean,
    converter: {
      fromAttribute: (v) => v !== null && v !== 'false' && v !== '0',
      toAttribute: (v: boolean) => (v ? '' : 'false'),
    },
  })
  skeleton = true;
  @property({ type: Boolean, attribute: 'no-viewer' }) noViewer = false;
  @property({ type: Boolean, reflect: true }) loaded = false;

  static styles = css`
    :host {
      position: relative;
      display: inline-block;
      max-width: 100%;
      vertical-align: middle;
    }
    :host(:not([loaded])) img[data-skeleton] {
      min-height: 8rem;
    }
    img {
      display: block;
      max-width: 100%;
      max-height: 100%;
    }
    .img-loading {
      position: absolute;
      left: 50%;
      top: 50%;
      z-index: 1;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
  `;

  private onLoad = () => {
    this.loaded = true;
  };

  protected updated(changed: Map<string, unknown>) {
    if (changed.has('skeleton')) {
      if (this.skeleton) this.setAttribute('skeleton', '');
      else this.setAttribute('skeleton', 'false');
    }
  }

  private onClick = () => {
    if (!this.loaded || this.noViewer) return;
    this.dispatchEvent(new CustomEvent<M3eImgOpenDetail>('open-image', {
      detail: { target: this },
      bubbles: true,
      composed: true,
    }));
  };

  render() {
    const sizeStyle = `${this.width ? `width:${this.width};` : ''}${this.height ? `height:${this.height};` : ''}`;
    const img = html`<img
      part="img"
      src=${this.src}
      alt=${this.alt}
      title=${this.title}
      style=${sizeStyle || nothing}
      ?data-skeleton=${this.skeleton}
      @load=${this.onLoad}
      @error=${this.onLoad}
    />`;
    const content = this.skeleton
      ? html`<m3e-skeleton ?loaded=${this.loaded}>${img}</m3e-skeleton>`
      : img;
    return html`
      <div part="container" @click=${this.onClick} style=${sizeStyle || nothing}>
        ${content}
        ${this.loaded ? nothing : html`<m3e-loading-indicator class="img-loading"></m3e-loading-indicator>`}
      </div>
    `;
  }
}

if (!customElements.get('m3e-img-mask')) {
  customElements.define('m3e-img-mask', M3eImgMask);
}

declare global {
  interface HTMLElementTagNameMap {
    'm3e-img-mask': M3eImgMask;
  }
}
