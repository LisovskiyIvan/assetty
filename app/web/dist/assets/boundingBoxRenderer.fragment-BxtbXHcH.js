import{b6 as e}from"./index-nL-PFW8x.js";import{b as i}from"./boundingBoxRendererUboDeclaration-cCiMH30-.js";const r="boundingBoxRendererFragmentDeclaration",d=`uniform vec4 color;
`;e.IncludesShadersStore[r]||(e.IncludesShadersStore[r]=d);const s={name:r,shader:d},o="boundingBoxRendererPixelShader",a=`#include<__decl__boundingBoxRendererFragment>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
gl_FragColor=color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStore[o]||(e.ShadersStore[o]=a);const t=[s,i];for(const n of t)e.IncludesShadersStore[n.name]||(e.IncludesShadersStore[n.name]=n.shader);const l={name:o,shader:a};export{l as boundingBoxRendererPixelShader};
