import{b6 as e}from"./index-PTYp95FF.js";import{clipPlaneFragmentDeclaration as a}from"./clipPlaneFragmentDeclaration-Br1mFdIf.js";import{logDepthDeclaration as i}from"./logDepthDeclaration-CY7wbJsi.js";import{l}from"./logDepthFragment-ozz_xa9x.js";import{clipPlaneFragment as t}from"./clipPlaneFragment-CP3xNskJ.js";import"./objectIdFunctions-Cw7rSI4G.js";const o="linePixelShader",n=`#include<clipPlaneFragmentDeclaration>
uniform vec4 color;
#ifdef LOGARITHMICDEPTH
#extension GL_EXT_frag_depth : enable
#endif
#include<logDepthDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<logDepthFragment>
#include<clipPlaneFragment>
gl_FragColor=color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const c=[a,i,l,t];for(const r of c)e.IncludesShadersStore[r.name]||(e.IncludesShadersStore[r.name]=r.shader);const h={name:o,shader:n};export{h as linePixelShader};
