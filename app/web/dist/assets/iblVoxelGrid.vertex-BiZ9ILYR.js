import{b6 as e}from"./index-nL-PFW8x.js";import{b as i,a as t,c as n,d as s}from"./bakedVertexAnimation-Cu8fycAt.js";import{i as l}from"./instancesDeclaration-S8vMHc3D.js";import{m as d,a as c,b as m,c as x}from"./morphTargetsVertex-uiidHV9y.js";import{i as p}from"./instancesVertex-FvaR03e_.js";const a="iblVoxelGridVertexShader",r=`attribute vec3 position;varying vec3 vNormalizedPosition;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<instancesDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
uniform mat4 invWorldScale;uniform mat4 viewMatrix;void main(void) {vec3 positionUpdated=position;
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);gl_Position=viewMatrix*invWorldScale*worldPos;vNormalizedPosition.xyz=gl_Position.xyz*0.5+0.5;
#ifdef IS_NDC_HALF_ZRANGE
gl_Position.z=gl_Position.z*0.5+0.5;
#endif
}`;e.ShadersStore[a]||(e.ShadersStore[a]=r);const u=[i,t,l,d,c,m,x,p,n,s];for(const o of u)e.IncludesShadersStore[o.name]||(e.IncludesShadersStore[o.name]=o.shader);const g={name:a,shader:r};export{g as iblVoxelGridVertexShader};
