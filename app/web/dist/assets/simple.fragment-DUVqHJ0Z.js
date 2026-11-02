import{b6 as e}from"./index-DwYVRG0U.js";import{helperFunctions as a}from"./helperFunctions-DWniefuq.js";import{l as r,a as f}from"./lightUboDeclaration-kynNakhA.js";import{lightsFragmentFunctions as l}from"./lightsFragmentFunctions-Dye8UP45.js";import{s as t}from"./shadowsFragmentFunctions-CVGSykdm.js";import{clipPlaneFragmentDeclaration as s}from"./clipPlaneFragmentDeclaration-CTT-PgKM.js";import{logDepthDeclaration as d}from"./logDepthDeclaration-2OBpBU7x.js";import{f as m,a as c}from"./fogFragment-DHhAWQWv.js";import{clipPlaneFragment as g}from"./clipPlaneFragment-r4rZtMcD.js";import{d as u}from"./depthPrePass-C2MbSaxI.js";import{lightFragment as v}from"./lightFragment-BlJvFNYC.js";import{l as p}from"./logDepthFragment--DB0nbTg.js";import{i as h}from"./imageProcessingCompatibility-Bpk2r9mR.js";import"./clusteredLightingFunctions-C1Vsi_mq.js";import"./objectIdFunctions-DZXusK9E.js";const o="simplePixelShader",n=`precision highp float;uniform vec4 vEyePosition;uniform vec4 vDiffuseColor;varying vec3 vPositionW;
#ifdef NORMAL
varying vec3 vNormalW;
#endif
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
varying vec4 vColor;
#endif
#include<helperFunctions>
#include<__decl__lightFragment>[0..maxSimultaneousLights]
#include<lightsFragmentFunctions>
#include<shadowsFragmentFunctions>
#ifdef DIFFUSE
varying vec2 vDiffuseUV;uniform sampler2D diffuseSampler;uniform vec2 vDiffuseInfos;
#endif
#include<clipPlaneFragmentDeclaration>
#ifdef LOGARITHMICDEPTH
#extension GL_EXT_frag_depth : enable
#endif
#include<logDepthDeclaration>
#include<fogFragmentDeclaration>
#if defined(CLUSTLIGHT_BATCH) && CLUSTLIGHT_BATCH>0
varying float vViewDepth;
#endif
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);vec4 baseColor=vec4(1.,1.,1.,1.);vec3 diffuseColor=vDiffuseColor.rgb;float alpha=vDiffuseColor.a;
#ifdef DIFFUSE
baseColor=texture2D(diffuseSampler,vDiffuseUV);
#ifdef ALPHATEST
if (baseColor.a<0.4)
discard;
#endif
#include<depthPrePass>
baseColor.rgb*=vDiffuseInfos.y;
#endif
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
baseColor.rgb*=vColor.rgb;
#endif
#ifdef NORMAL
vec3 normalW=normalize(vNormalW);
#else
vec3 normalW=vec3(1.0,1.0,1.0);
#endif
vec3 diffuseBase=vec3(0.,0.,0.);lightingInfo info;float shadow=1.;float glossiness=0.;float aggShadow=0.;float numLights=0.;
#ifdef SPECULARTERM
vec3 specularBase=vec3(0.,0.,0.);
#endif 
#include<lightFragment>[0..maxSimultaneousLights]
#if defined(VERTEXALPHA) || defined(INSTANCESCOLOR) && defined(INSTANCES)
alpha*=vColor.a;
#endif
vec3 finalDiffuse=clamp(diffuseBase*diffuseColor,0.0,1.0)*baseColor.rgb;vec4 color=vec4(finalDiffuse,alpha);
#include<logDepthFragment>
#include<fogFragment>
gl_FragColor=color;
#include<imageProcessingCompatibility>
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const S=[a,r,f,l,t,s,d,m,g,u,v,p,c,h];for(const i of S)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const y={name:o,shader:n};export{y as simplePixelShader};
