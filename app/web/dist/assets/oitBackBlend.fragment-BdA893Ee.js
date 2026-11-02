import{b6 as r}from"./index-nL-PFW8x.js";const o="oitBackBlendPixelShader",e=`precision highp float;uniform sampler2D uBackColor;void main() {glFragColor=texelFetch(uBackColor,ivec2(gl_FragCoord.xy),0);if (glFragColor.a==0.0) { 
discard;}}`;r.ShadersStore[o]||(r.ShadersStore[o]=e);const i={name:o,shader:e};export{i as oitBackBlendPixelShader};
